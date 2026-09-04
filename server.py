#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server.py - Servidor Python amb SQLite i API REST per al Taller de Ceràmica
"""

import http.server
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import urllib.parse
import urllib.request
from datetime import datetime

PORT = int(os.environ.get('PORT', 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'data', 'ceramica.db')

# Assegurar directori data/
os.makedirs(os.path.join(BASE_DIR, 'data'), exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        # Taula d'alumnes
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS alumnes (
                id TEXT PRIMARY KEY,
                nom TEXT NOT NULL,
                cognoms TEXT NOT NULL,
                telefon TEXT,
                email TEXT,
                pin TEXT,
                data_alta TEXT NOT NULL,
                notes TEXT,
                actiu INTEGER DEFAULT 1,
                edat INTEGER DEFAULT NULL
            )
        ''')
        # Taula de paquets d'hores (compres)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS paquets_hores (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                data TEXT NOT NULL,
                hores REAL NOT NULL,
                segons INTEGER NOT NULL,
                concepte TEXT,
                preu REAL DEFAULT 0,
                metode_pagament TEXT DEFAULT 'Efectiu',
                stripe_session_id TEXT,
                notes TEXT,
                FOREIGN KEY (student_id) REFERENCES alumnes (id)
            )
        ''')
        # Taula de sessions (entrades i sortides)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                data TEXT NOT NULL,
                entrada TEXT NOT NULL,
                sortida TEXT,
                durada_segons INTEGER DEFAULT 0,
                format_hms TEXT DEFAULT '00:00:00',
                tipus TEXT DEFAULT 'qr',
                estat TEXT DEFAULT 'oberta',
                notes TEXT,
                FOREIGN KEY (student_id) REFERENCES alumnes (id)
            )
        ''')
        # Taula de reserves (control d'aforament, activitats i places)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS reserves (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                student_nom TEXT,
                data TEXT NOT NULL,
                hora_inici TEXT NOT NULL,
                hora_fi TEXT NOT NULL,
                franja TEXT NOT NULL,
                activitat TEXT DEFAULT 'Torn',
                activitat_id TEXT DEFAULT 'torn',
                places INTEGER DEFAULT 1,
                telefon TEXT DEFAULT '',
                estat TEXT DEFAULT 'confirmada',
                hores REAL DEFAULT 1.5,
                notes TEXT,
                created_at TEXT NOT NULL,
                calendar_event_id TEXT DEFAULT NULL,
                FOREIGN KEY (student_id) REFERENCES alumnes (id)
            )
        ''')
        # Migració de columnes addicionals per a bases de dades existents
        for col, col_type in [
            ('activitat', "TEXT DEFAULT 'Torn'"),
            ('activitat_id', "TEXT DEFAULT 'torn'"),
            ('places', "INTEGER DEFAULT 1"),
            ('telefon', "TEXT DEFAULT ''"),
            ('calendar_event_id', "TEXT DEFAULT NULL")
        ]:
            try:
                cursor.execute(f"ALTER TABLE reserves ADD COLUMN {col} {col_type}")
            except Exception:
                pass

        # Migració de columna edat a la taula alumnes si no existeix
        try:
            cursor.execute("ALTER TABLE alumnes ADD COLUMN edat INTEGER DEFAULT NULL")
        except Exception:
            pass

        # Taula de configuració
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS configuracio (
                clau TEXT PRIMARY KEY,
                valor TEXT
            )
        ''')

        # Franges horàries oficials de 90 minuts (Roig de Coure)
        default_franges_json = json.dumps([
            {"id": "F1", "nom": "Matí 1 (10:00 - 11:30)", "inici": "10:00", "fi": "11:30", "hores": 1.5},
            {"id": "F2", "nom": "Matí 2 (11:30 - 13:00)", "inici": "11:30", "fi": "13:00", "hores": 1.5},
            {"id": "F3", "nom": "Tarda 1 (17:00 - 18:30)", "inici": "17:00", "fi": "18:30", "hores": 1.5},
            {"id": "F4", "nom": "Tarda 2 (18:30 - 20:00)", "inici": "18:30", "fi": "20:00", "hores": 1.5}
        ], ensure_ascii=False)

        # Valors de configuració inicials per defecte si no existeixen
        default_config = {
            'taller_nom': "Roig de Coure",
            'taller_subtitol': "Taller d'Art i Ceràmica",
            'taller_telefon': "+34 600 000 000",
            'taller_email': "roigdecoure@gmail.com",
            'taller_logo_url': "",
            'brand_primary': "#C25E3A",
            'brand_secondary': "#5E7E6F",
            'brand_font': "serif",
            'brand_palette': "roigdecoure",
            'hores_per_defecte_oblit': "01:30:00",
            'stripe_url_adults': "https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n",
            'stripe_url_infantil': "https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j",
            'edat_tall_infantil': "12",
            'stripe_pack5_url': "",
            'stripe_pack10_url': "",
            'stripe_pack20_url': "",
            'google_sheets_url': "",
            'google_calendar_name': "Roig de Coure",
            'aforament_maxim_per_franja': "12",
            'franges_horaries': default_franges_json
        }
        for k, v in default_config.items():
            cursor.execute('INSERT OR IGNORE INTO configuracio (clau, valor) VALUES (?, ?)', (k, v))

        # Migració de valors antics a configuració oficial si cal
        cursor.execute('UPDATE configuracio SET valor = "12" WHERE clau = "aforament_maxim_per_franja" AND valor = "8"')
        cursor.execute('UPDATE configuracio SET valor = ? WHERE clau = "franges_horaries" AND valor LIKE "%mati_1%"', (default_franges_json,))
        cursor.execute('UPDATE configuracio SET valor = "https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n" WHERE clau = "stripe_url_adults" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j" WHERE clau = "stripe_url_infantil" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "12" WHERE clau = "edat_tall_infantil" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "Roig de Coure" WHERE clau = "google_calendar_name" AND (valor = "" OR valor IS NULL)')

        # Dades inicials de demostració si la base de dades és buida
        cursor.execute('SELECT COUNT(*) as count FROM alumnes')
        if cursor.fetchone()['count'] == 0:
            now_iso = datetime.now().isoformat()
            demo_students = [
                ('TC-101', 'Maria', 'Garcia Font', '612345678', 'maria.garcia@email.com', '1001', now_iso, 'Curs de torn nivell mig', 1, 32),
                ('TC-102', 'Jordi', 'Rovira Pons', '623456789', 'jordi.rovira@email.com', '1002', now_iso, 'Modelatge i escultura', 1, 28),
                ('TC-103', 'Clara', 'Vidal Soler', '634567890', 'clara.vidal@email.com', '1003', now_iso, 'Esmalts i pintura infantil', 1, 10)
            ]
            cursor.executemany('''
                INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu, edat)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', demo_students)

            # Paquets inicials
            cursor.execute('''
                INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament, notes)
                VALUES 
                ('PK-101-1', 'TC-101', ?, 10.0, 36000, 'Pack 10 Hores Torn', 120.0, 'Stripe', 'Pagat amb Stripe'),
                ('PK-102-1', 'TC-102', ?, 5.0, 18000, 'Pack 5 Hores Modelatge', 65.0, 'Bizum', 'Pagat per Bizum'),
                ('PK-103-1', 'TC-103', ?, 20.0, 72000, 'Pack 20 Hores Taller Lliure', 220.0, 'Targeta', 'Compra inicial')
            ''', (now_iso, now_iso, now_iso))

            # Sessió d'exemple tancada per a Maria
            cursor.execute('''
                INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat, notes)
                VALUES ('SES-DEMO-1', 'TC-101', '2026-09-01', '2026-09-01T10:00:00', '2026-09-01T11:45:20', 6320, '01:45:20', 'qr', 'tancada', 'Sessió de torn')
            ''')
        conn.commit()

init_db()

def get_google_sheets_url():
    """Obté l'URL de Google Sheets des de variable d'entorn (Render) o de la base de dades"""
    env_url = os.environ.get('GOOGLE_SHEETS_URL', '').strip()
    if env_url:
        return env_url
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT valor FROM configuracio WHERE clau = 'google_sheets_url'")
            row = cursor.fetchone()
            if row and row['valor']:
                return row['valor'].strip()
    except Exception:
        pass
    return ''

def hydrate_from_google_sheets(target_url=None):
    """
    Descàrrega inicial i bolcat (hidratació) des de Google Sheets cap a SQLite.
    Garanteix la persistència total a Render fins i tot després de reinicis de contenidor.
    """
    url = (target_url or get_google_sheets_url()).strip()
    if not url:
        print("[Google Sheets] Cap URL configurat. S'utilitza la base de dades local SQLite.")
        return {'ok': False, 'message': 'Cap URL de Google Sheets configurat.'}

    print(f"[Google Sheets] ⏳ Iniciant hidratació des de Google Sheets...")
    try:
        req_url = url
        if 'action=' not in req_url:
            separator = '&' if '?' in req_url else '?'
            req_url = f"{req_url}{separator}action=get_all"

        req = urllib.request.Request(
            req_url,
            headers={'User-Agent': 'TallerCeramicaBackend/1.0', 'Accept': 'application/json'}
        )

        opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
        with opener.open(req, timeout=25) as resp:
            raw = resp.read().decode('utf-8')
            res = json.loads(raw)

        if res.get('status') != 'success' or 'data' not in res:
            print(f"[Google Sheets] ⚠️ Resposta inesperada: {res}")
            return {'ok': False, 'error': 'Resposta no reconeguda de Google Sheets', 'raw': res}

        data = res['data']
        alumnes = data.get('alumnes', [])
        paquets = data.get('paquets', [])
        sessions = data.get('sessions', [])
        config = data.get('config', {})

        reserves = data.get('reserves', [])

        with get_db() as conn:
            cursor = conn.cursor()

            # 1. Bolcar alumnes
            for a in alumnes:
                if not a.get('id'):
                    continue
                cursor.execute('''
                    INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        nom = excluded.nom,
                        cognoms = excluded.cognoms,
                        telefon = excluded.telefon,
                        email = excluded.email,
                        pin = excluded.pin,
                        data_alta = excluded.data_alta,
                        notes = excluded.notes,
                        actiu = excluded.actiu
                ''', (
                    a['id'], a.get('nom', ''), a.get('cognoms', ''),
                    a.get('telefon', ''), a.get('email', ''), a.get('pin', '1234'),
                    a.get('data_alta', datetime.now().isoformat()),
                    a.get('notes', ''), int(a.get('actiu', 1))
                ))

            # 2. Bolcar paquets d'hores
            for p in paquets:
                if not p.get('id') or not p.get('student_id'):
                    continue
                cursor.execute('''
                    INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        student_id = excluded.student_id,
                        data = excluded.data,
                        hores = excluded.hores,
                        segons = excluded.segons,
                        concepte = excluded.concepte,
                        preu = excluded.preu,
                        metode_pagament = excluded.metode_pagament,
                        notes = excluded.notes
                ''', (
                    p['id'], p['student_id'], p.get('data', datetime.now().isoformat()),
                    float(p.get('hores', 0)), int(p.get('segons', 0)),
                    p.get('concepte', 'Pack d\'hores'), float(p.get('preu', 0)),
                    p.get('metode_pagament', 'Stripe'), p.get('notes', '')
                ))

            # 3. Bolcar sessions (preservant sessions obertes i tancades)
            for s in sessions:
                if not s.get('id') or not s.get('student_id'):
                    continue
                cursor.execute('''
                    INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        student_id = excluded.student_id,
                        data = excluded.data,
                        entrada = excluded.entrada,
                        sortida = excluded.sortida,
                        durada_segons = excluded.durada_segons,
                        format_hms = excluded.format_hms,
                        tipus = excluded.tipus,
                        estat = excluded.estat,
                        notes = excluded.notes
                ''', (
                    s['id'], s['student_id'], s.get('data', ''),
                    s.get('entrada', ''), s.get('sortida'),
                    int(s.get('durada_segons', 0)), s.get('format_hms', '00:00:00'),
                    s.get('tipus', 'qr'), s.get('estat', 'oberta'),
                    s.get('notes', '')
                ))

            # 4. Bolcar reserves (aforament, activitats i places reservades)
            for r in reserves:
                if not r.get('id') or not r.get('student_id'):
                    continue
                cursor.execute('''
                    INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, estat, hores, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        student_id = excluded.student_id,
                        student_nom = excluded.student_nom,
                        data = excluded.data,
                        hora_inici = excluded.hora_inici,
                        hora_fi = excluded.hora_fi,
                        franja = excluded.franja,
                        activitat = excluded.activitat,
                        activitat_id = excluded.activitat_id,
                        places = excluded.places,
                        telefon = excluded.telefon,
                        estat = excluded.estat,
                        hores = excluded.hores,
                        notes = excluded.notes,
                        created_at = excluded.created_at
                ''', (
                    r['id'], r['student_id'], r.get('student_nom', ''),
                    r.get('data', ''), r.get('hora_inici', '10:00'), r.get('hora_fi', '11:30'),
                    r.get('franja', 'F1'), r.get('activitat', 'Torn'),
                    r.get('activitat_id', 'torn'), int(r.get('places', 1)),
                    r.get('telefon', ''), r.get('estat', 'confirmada'),
                    float(r.get('hores', 1.5)), r.get('notes', ''),
                    r.get('created_at', datetime.now().isoformat())
                ))

            # 5. Bolcar configuració
            for k, v in config.items():
                if k:
                    cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))

            conn.commit()

        msg = f"Hidratació completada: {len(alumnes)} alumnes, {len(paquets)} paquets, {len(sessions)} sessions, {len(reserves)} reserves sincronitzades des de Google Sheets."
        print(f"[Google Sheets] ✅ {msg}")
        return {
            'ok': True,
            'message': msg,
            'counts': {
                'alumnes': len(alumnes),
                'paquets': len(paquets),
                'sessions': len(sessions),
                'reserves': len(reserves)
            }
        }
    except Exception as e:
        err_msg = f"Error durant la hidratació: {str(e)}"
        print(f"[Google Sheets] ⚠️ {err_msg}")
        return {'ok': False, 'error': err_msg}

def sync_to_google_sheets_async(action, payload):
    """
    Envia esdeveniments de forma asíncrona a Google Sheets en segon pla.
    No bloqueja la resposta de la petició de l'usuari/escàner.
    """
    def _worker():
        url = get_google_sheets_url()
        if not url:
            return
        try:
            body = json.dumps({
                'action': action,
                'payload': payload,
                'timestamp': datetime.now().isoformat()
            }, ensure_ascii=False).encode('utf-8')

            req = urllib.request.Request(
                url,
                data=body,
                headers={'Content-Type': 'application/json', 'User-Agent': 'TallerCeramicaBackend/1.0'}
            )
            opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
            with opener.open(req, timeout=20) as resp:
                resp.read()
        except Exception as e:
            print(f"[Google Sheets Sync] Avís enviant '{action}': {e}")

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

# Intentar hidratació inicial automàtica a l'arrencada si tenim URL
try:
    hydrate_from_google_sheets()
except Exception as e:
    print(f"[Google Sheets] Avís inicialitzant hidratació: {e}")

def row_to_dict(row):
    return dict(row) if row else None

def format_hms(seconds):
    if seconds is None:
        return "00:00:00"
    is_neg = seconds < 0
    sec = abs(int(round(seconds)))
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    fmt = f"{h:02d}:{m:02d}:{s:02d}"
    return f"-{fmt}" if is_neg else fmt

def get_student_balance(student_id):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT SUM(segons) as total_bought FROM paquets_hores WHERE student_id = ?', (student_id,))
        res_bought = cursor.fetchone()
        total_bought = res_bought['total_bought'] or 0

        cursor.execute('SELECT SUM(durada_segons) as total_spent FROM sessions WHERE student_id = ? AND estat != "oberta"', (student_id,))
        res_spent = cursor.fetchone()
        total_spent = res_spent['total_spent'] or 0

        balance_sec = total_bought - total_spent
        return {
            'totalBoughtSeconds': total_bought,
            'totalSpentSeconds': total_spent,
            'balanceSeconds': balance_sec,
            'formatBought': format_hms(total_bought),
            'formatSpent': format_hms(total_spent),
            'formatBalance': format_hms(balance_sec),
            'isNegative': balance_sec < 0,
            'isLow': 0 <= balance_sec < 7200
        }

ACTIVITATS = [
    {"id": "torn", "nom": "Torn", "descripcio": "Sessió al torn de terrissaire", "capacitatMax": 4, "icon": "🏺", "color": "#3B82F6"},
    {"id": "modelatge", "nom": "Modelatge", "descripcio": "Modelat de fang a mà i escultura", "capacitatMax": 8, "icon": "🗿", "color": "#10B981"},
    {"id": "vidre", "nom": "Vidre", "descripcio": "Treball i decoració en vidre", "capacitatMax": 8, "icon": "🔮", "color": "#8B5CF6"},
    {"id": "pintar", "nom": "Pintar ceràmica", "descripcio": "Pintura i esmaltat sobre ceràmica", "capacitatMax": 12, "icon": "🎨", "color": "#F59E0B"}
]

DEFAULT_FRANGES = [
    {"id": "F1", "nom": "Matí 1 (10:00 - 11:30)", "inici": "10:00", "fi": "11:30", "hores": 1.5},
    {"id": "F2", "nom": "Matí 2 (11:30 - 13:00)", "inici": "11:30", "fi": "13:00", "hores": 1.5},
    {"id": "F3", "nom": "Tarda 1 (17:00 - 18:30)", "inici": "17:00", "fi": "18:30", "hores": 1.5},
    {"id": "F4", "nom": "Tarda 2 (18:30 - 20:00)", "inici": "18:30", "fi": "20:00", "hores": 1.5}
]

FESTIUS_CATALUNYA = [
    {"data": "2026-01-01", "nom": "Cap d'Any"},
    {"data": "2026-01-06", "nom": "Reis"},
    {"data": "2026-04-03", "nom": "Divendres Sant"},
    {"data": "2026-04-06", "nom": "Dilluns de Pasqua"},
    {"data": "2026-05-01", "nom": "Festa del Treball"},
    {"data": "2026-06-24", "nom": "Sant Joan"},
    {"data": "2026-08-15", "nom": "L'Assumpció"},
    {"data": "2026-09-11", "nom": "Diada Nacional de Catalunya"},
    {"data": "2026-10-12", "nom": "Festa Nacional d'Espanya"},
    {"data": "2026-11-01", "nom": "Tots Sants"},
    {"data": "2026-12-06", "nom": "Dia de la Constitució"},
    {"data": "2026-12-08", "nom": "La Immaculada"},
    {"data": "2026-12-25", "nom": "Nadal"},
    {"data": "2026-12-26", "nom": "Sant Esteve"}
]

def is_dia_tancat(data_str):
    try:
        dt = datetime.strptime(data_str, '%Y-%m-%d')
    except Exception:
        return {'tancat': True, 'motiu': 'Data no vàlida'}

    # Dilluns (0) i Dimarts (1) tancat per descans setmanal. Obrim Dimecres (2) a Diumenge (6).
    weekday = dt.weekday()
    if weekday in (0, 1):
        nom_dia = "Dilluns" if weekday == 0 else "Dimarts"
        return {
            'tancat': True,
            'motiu': f"Tancat per descans setmanal ({nom_dia}). Obrim de Dimecres a Diumenge."
        }

    # Festius oficials de Catalunya
    for f in FESTIUS_CATALUNYA:
        if f['data'] == data_str:
            return {
                'tancat': True,
                'motiu': f"Tancat per festiu ({f['nom']})."
            }

    return {'tancat': False, 'motiu': ''}

def get_franges_config():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT valor FROM configuracio WHERE clau = "franges_horaries"')
        r = cursor.fetchone()
        if r and r['valor']:
            try:
                fr = json.loads(r['valor'])
                if fr and isinstance(fr, list) and len(fr) > 0:
                    return fr
            except Exception:
                pass
    return DEFAULT_FRANGES

def get_aforament_maxim():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT valor FROM configuracio WHERE clau = "aforament_maxim_per_franja"')
        r = cursor.fetchone()
        if r and r['valor']:
            try:
                val = int(r['valor'])
                if val > 0:
                    return val
            except Exception:
                pass
    return 12

def get_disponibilitat(data_str):
    franges = get_franges_config()
    max_cap = get_aforament_maxim()
    estat_dia = is_dia_tancat(data_str)

    if estat_dia['tancat']:
        return {
            'data': data_str,
            'tancat': True,
            'motiu': estat_dia['motiu'],
            'aforamentMaxim': max_cap,
            'totalPlacesDia': 0,
            'totalOcupadesDia': 0,
            'franges': [],
            'activitats': ACTIVITATS
        }

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT r.*, a.nom, a.cognoms, a.telefon
            FROM reserves r
            LEFT JOIN alumnes a ON r.student_id = a.id
            WHERE r.data = ? AND r.estat = 'confirmada'
            ORDER BY r.hora_inici ASC
        ''', (data_str,))
        active_reserves = [row_to_dict(x) for x in cursor.fetchall()]

    result_franges = []
    total_ocupades_dia = 0

    for f in franges:
        f_id = f['id']
        f_res = [r for r in active_reserves if r.get('franja') == f_id or r.get('franja') == f.get('nom')]
        ocupades_franja = sum(int(r.get('places') or 1) for r in f_res)
        total_ocupades_dia += ocupades_franja
        lliures_franja = max(0, max_cap - ocupades_franja)
        esta_complet = (lliures_franja == 0)

        # Ocupació per activitat respectant el límit absolut de la franja (màxim 12)
        ocupacio_per_act = {}
        activitats_franja = []
        for act in ACTIVITATS:
            act_id = act['id']
            act_nom = act['nom'].lower()
            ocupat_act = sum(int(r.get('places') or 1) for r in f_res if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act_nom)
            ocupacio_per_act[act_id] = ocupat_act
            capacitat_max_act = act['capacitatMax']
            lliures_act = max(0, capacitat_max_act - ocupat_act)
            # El límit efectiu és el mínim entre les places lliures de la franja i les de l'activitat
            places_efectives = min(lliures_franja, lliures_act)
            activitats_franja.append({
                'id': act_id,
                'nom': act['nom'],
                'icon': act['icon'],
                'color': act['color'],
                'capacitatMax': capacitat_max_act,
                'ocupat': ocupat_act,
                'placesDisponibles': places_efectives,
                'complet': places_efectives == 0
            })

        if lliures_franja == 0:
            estat_franja = 'complet'
        elif lliures_franja <= 3 and ocupades_franja > 0:
            estat_franja = 'ultimes_places'
        else:
            estat_franja = 'lliure'

        result_franges.append({
            'id': f_id,
            'nom': f.get('nom'),
            'inici': f.get('inici'),
            'fi': f.get('fi'),
            'hores': f.get('hores', 1.5),
            'totalPlaces': max_cap,
            'placesOcupades': ocupades_franja,
            'placesLliures': lliures_franja,
            'estat': estat_franja,
            'estaComplet': esta_complet,
            'ocupacioPerActivitat': ocupacio_per_act,
            'activitats': activitats_franja,
            'reserves': f_res
        })

    return {
        'data': data_str,
        'tancat': False,
        'motiu': '',
        'aforamentMaxim': max_cap,
        'totalPlacesDia': max_cap * len(franges),
        'totalOcupadesDia': total_ocupades_dia,
        'franges': result_franges,
        'activitats': ACTIVITATS
    }

def get_disponibilitat_mes(year, month):
    import calendar
    _, num_days = calendar.monthrange(year, month)
    franges = get_franges_config()
    max_cap = get_aforament_maxim()

    start_date = f"{year:04d}-{month:02d}-01"
    end_date = f"{year:04d}-{month:02d}-{num_days:02d}"

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT data, franja, activitat_id, activitat, places
            FROM reserves
            WHERE data >= ? AND data <= ? AND estat = 'confirmada'
        ''', (start_date, end_date))
        month_reserves = [row_to_dict(x) for x in cursor.fetchall()]

    days_dict = {}
    for day in range(1, num_days + 1):
        data_str = f"{year:04d}-{month:02d}-{day:02d}"
        estat_dia = is_dia_tancat(data_str)
        if estat_dia['tancat']:
            days_dict[data_str] = {
                'data': data_str,
                'tancat': True,
                'motiu': estat_dia['motiu'],
                'placesTotals': 0,
                'placesOcupades': 0,
                'placesLliures': 0,
                'estat': 'tancat',
                'activitatsAmbPlaces': []
            }
            continue

        day_res = [r for r in month_reserves if r.get('data') == data_str]
        total_ocupat_dia = sum(int(r.get('places') or 1) for r in day_res)
        total_places_dia = max_cap * len(franges)
        total_lliures_dia = max(0, total_places_dia - total_ocupat_dia)

        acts_amb_places = []
        for act in ACTIVITATS:
            act_id = act['id']
            act_nom = act['nom'].lower()
            has_spot = False
            for f in franges:
                f_id = f['id']
                f_res = [r for r in day_res if r.get('franja') == f_id or r.get('franja') == f.get('nom')]
                ocupades_franja = sum(int(r.get('places') or 1) for r in f_res)
                lliures_franja = max(0, max_cap - ocupades_franja)
                if lliures_franja > 0:
                    ocupat_act = sum(int(r.get('places') or 1) for r in f_res if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act_nom)
                    if ocupat_act < act['capacitatMax']:
                        has_spot = True
                        break
            if has_spot:
                acts_amb_places.append(act_id)

        if total_lliures_dia == 0:
            estat = 'complet'
        elif total_lliures_dia <= (len(franges) * 2):
            estat = 'ultimes_places'
        else:
            estat = 'lliure'

        days_dict[data_str] = {
            'data': data_str,
            'tancat': False,
            'motiu': '',
            'placesTotals': total_places_dia,
            'placesOcupades': total_ocupat_dia,
            'placesLliures': total_lliures_dia,
            'estat': estat,
            'activitatsAmbPlaces': acts_amb_places
        }

    return {
        'any': year,
        'mes': month,
        'aforamentMaximFranja': max_cap,
        'dies': days_dict,
        'activitats': ACTIVITATS
    }

class CeramicsRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        params = urllib.parse.parse_qs(url.query)

        if not path.startswith('/api/'):
            # Servir arxius estàtics
            return super().do_GET()

        try:
            if path == '/api/status':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT COUNT(*) as alumnes FROM alumnes WHERE actiu = 1')
                    tot_alumnes = cursor.fetchone()['alumnes']
                    cursor.execute('SELECT COUNT(*) as actius FROM sessions WHERE estat = "oberta"')
                    alumnes_actius = cursor.fetchone()['actius']
                self.send_json({'ok': True, 'alumnesTotals': tot_alumnes, 'alumnesAlTaller': alumnes_actius, 'timestamp': datetime.now().isoformat()})
                return

            elif path == '/api/alumnes':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM alumnes WHERE actiu = 1 ORDER BY nom ASC, cognoms ASC')
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                    # Afegir estat actual i saldo a cada alumne
                    for a in rows:
                        cursor.execute('SELECT * FROM sessions WHERE student_id = ? AND estat = "oberta" ORDER BY entrada DESC LIMIT 1', (a['id'],))
                        open_sess = cursor.fetchone()
                        a['sessioActiva'] = row_to_dict(open_sess)
                        a['balanc'] = get_student_balance(a['id'])
                self.send_json({'ok': True, 'data': rows})
                return

            elif path.startswith('/api/alumnes/'):
                student_id = path.replace('/api/alumnes/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM alumnes WHERE id = ?', (student_id,))
                    student = row_to_dict(cursor.fetchone())
                    if not student:
                        self.send_json({'ok': False, 'error': 'Alumne no trobat'}, 404)
                        return

                    cursor.execute('SELECT * FROM paquets_hores WHERE student_id = ? ORDER BY data DESC', (student_id,))
                    packs = [row_to_dict(r) for r in cursor.fetchall()]

                    cursor.execute('SELECT * FROM sessions WHERE student_id = ? ORDER BY entrada DESC', (student_id,))
                    sessions = [row_to_dict(r) for r in cursor.fetchall()]

                    cursor.execute('SELECT * FROM sessions WHERE student_id = ? AND estat = "oberta" ORDER BY entrada DESC LIMIT 1', (student_id,))
                    active_session = row_to_dict(cursor.fetchone())

                    balance = get_student_balance(student_id)

                self.send_json({
                    'ok': True,
                    'alumne': student,
                    'paquets': packs,
                    'sessions': sessions,
                    'sessioActiva': active_session,
                    'balanc': balance
                })
                return

            elif path == '/api/sessions':
                student_id = params.get('student_id', [None])[0]
                estat = params.get('estat', [None])[0]
                with get_db() as conn:
                    cursor = conn.cursor()
                    query = '''
                        SELECT s.*, a.nom, a.cognoms, a.telefon 
                        FROM sessions s
                        JOIN alumnes a ON s.student_id = a.id
                        WHERE 1=1
                    '''
                    q_args = []
                    if student_id:
                        query += ' AND s.student_id = ?'
                        q_args.append(student_id)
                    if estat:
                        query += ' AND s.estat = ?'
                        q_args.append(estat)
                    query += ' ORDER BY s.entrada DESC'
                    cursor.execute(query, q_args)
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'data': rows})
                return

            elif path == '/api/paquets':
                student_id = params.get('student_id', [None])[0]
                with get_db() as conn:
                    cursor = conn.cursor()
                    query = '''
                        SELECT p.*, a.nom, a.cognoms 
                        FROM paquets_hores p
                        JOIN alumnes a ON p.student_id = a.id
                    '''
                    q_args = []
                    if student_id:
                        query += ' WHERE p.student_id = ?'
                        q_args.append(student_id)
                    query += ' ORDER BY p.data DESC'
                    cursor.execute(query, q_args)
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'data': rows})
                return

            elif path == '/api/reserves':
                data_filter = params.get('data', [None])[0]
                student_id = params.get('student_id', [None])[0]
                estat = params.get('estat', [None])[0]
                with get_db() as conn:
                    cursor = conn.cursor()
                    q = '''
                        SELECT r.*, a.nom, a.cognoms, a.telefon 
                        FROM reserves r
                        LEFT JOIN alumnes a ON r.student_id = a.id
                        WHERE 1=1
                    '''
                    args = []
                    if data_filter:
                        q += ' AND r.data = ?'
                        args.append(data_filter)
                    if student_id:
                        q += ' AND r.student_id = ?'
                        args.append(student_id)
                    if estat:
                        q += ' AND r.estat = ?'
                        args.append(estat)
                    q += ' ORDER BY r.data ASC, r.hora_inici ASC'
                    cursor.execute(q, args)
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'data': rows})
                return

            elif path == '/api/reserves/disponibilitat':
                data_str = params.get('data', [datetime.now().strftime('%Y-%m-%d')])[0]
                disp = get_disponibilitat(data_str)
                self.send_json({'ok': True, **disp})
                return

            elif path == '/api/reserves/mes':
                now = datetime.now()
                try:
                    any_val = int(params.get('any', [now.year])[0])
                    mes_val = int(params.get('mes', [now.month])[0])
                except Exception:
                    any_val, mes_val = now.year, now.month
                disp_mes = get_disponibilitat_mes(any_val, mes_val)
                self.send_json({'ok': True, **disp_mes})
                return

            elif path == '/api/reserves/activitats':
                self.send_json({'ok': True, 'activitats': ACTIVITATS})
                return

            elif path == '/api/config':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT clau, valor FROM configuracio')
                    rows = cursor.fetchall()
                    cfg = {r['clau']: r['valor'] for r in rows}
                self.send_json({'ok': True, 'config': cfg})
                return

            elif path == '/api/export':
                # Exportació de backup complet JSON
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM alumnes')
                    alumnes = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM paquets_hores')
                    paquets = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM sessions')
                    sessions = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM reserves')
                    reserves = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM configuracio')
                    config = {r['clau']: r['valor'] for r in cursor.fetchall()}
                self.send_json({
                    'versio': '1.0',
                    'timestamp': datetime.now().isoformat(),
                    'alumnes': alumnes,
                    'paquets': paquets,
                    'sessions': sessions,
                    'reserves': reserves,
                    'config': config
                })
                return

            elif path == '/api/sync/status':
                url = get_google_sheets_url()
                self.send_json({
                    'ok': True,
                    'configured': bool(url),
                    'urlPreview': (url[:35] + '...') if url else ''
                })
                return

            else:
                self.send_json({'ok': False, 'error': 'Ruta API no trobada'}, 404)
        except Exception as e:
            self.send_json({'ok': False, 'error': str(e)}, 500)

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')
        data = {}
        if post_data:
            try:
                data = json.loads(post_data)
            except Exception:
                data = {}

        try:
            if path == '/api/alumnes':
                # Crear o actualitzar alumne
                student_id = (data.get('id') or '').strip()
                nom = (data.get('nom') or '').strip()
                cognoms = (data.get('cognoms') or '').strip()
                telefon = (data.get('telefon') or '').strip()
                email = (data.get('email') or '').strip()
                pin = (data.get('pin') or '').strip()
                notes = (data.get('notes') or '').strip()
                edat_raw = data.get('edat')
                edat = None
                if edat_raw is not None and str(edat_raw).strip() != '':
                    try:
                        edat = int(edat_raw)
                    except (ValueError, TypeError):
                        edat = None

                if not nom:
                    self.send_json({'ok': False, 'error': 'El nom és obligatori'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    if not student_id:
                        # Generar nou ID: TC-101, TC-102, ...
                        cursor.execute('SELECT id FROM alumnes WHERE id LIKE "TC-%" ORDER BY id DESC')
                        existing = cursor.fetchall()
                        max_num = 100
                        for r in existing:
                            m = re.search(r'TC-(\d+)', r['id'])
                            if m:
                                max_num = max(max_num, int(m.group(1)))
                        student_id = f"TC-{max_num + 1}"
                        if not pin:
                            pin = str(max_num + 1)

                    data_alta = data.get('data_alta') or datetime.now().isoformat()

                    cursor.execute('''
                        INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu, edat)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            nom=excluded.nom,
                            cognoms=excluded.cognoms,
                            telefon=excluded.telefon,
                            email=excluded.email,
                            pin=excluded.pin,
                            notes=excluded.notes,
                            edat=excluded.edat
                    ''', (student_id, nom, cognoms, telefon, email, pin, data_alta, notes, edat))
                    conn.commit()

                # Sincronitzar amb Google Sheets de forma persistent en segon pla
                sync_to_google_sheets_async('sync_alumne', {
                    'id': student_id,
                    'nom': nom,
                    'cognoms': cognoms,
                    'telefon': telefon,
                    'email': email,
                    'pin': pin,
                    'data_alta': data_alta,
                    'notes': notes,
                    'actiu': 1,
                    'edat': edat
                })

                self.send_json({'ok': True, 'id': student_id, 'message': 'Alumne desat correctament'})
                return

            elif path == '/api/checkin':
                # Check-in / Check-out intel·ligent per codi QR o ID
                code = (data.get('code') or '').strip()
                if not code:
                    self.send_json({'ok': False, 'error': 'Codi d\'alumne buit'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    # Cerca per ID directe (ex: TC-101) o PIN o telèfon
                    cursor.execute('''
                        SELECT * FROM alumnes 
                        WHERE actiu = 1 AND (id = ? OR pin = ? OR telefon = ?)
                    ''', (code, code, code))
                    student = row_to_dict(cursor.fetchone())

                    if not student:
                        self.send_json({'ok': False, 'error': f'No s\'ha trobat cap alumne amb el codi "{code}"'}, 404)
                        return

                    student_id = student['id']
                    requested_action = (data.get('action') or 'auto').lower()
                    custom_time = data.get('customTime')
                    tipus = data.get('tipus') or ('manual' if requested_action in ('entrada', 'sortida') else 'qr')

                    if custom_time:
                        try:
                            now = datetime.fromisoformat(custom_time)
                        except Exception:
                            now = datetime.now()
                    else:
                        now = datetime.now()

                    now_iso = now.isoformat()
                    today = now.strftime('%Y-%m-%d')

                    # Comprovar si té una sessió oberta
                    cursor.execute('''
                        SELECT * FROM sessions 
                        WHERE student_id = ? AND estat = "oberta" 
                        ORDER BY entrada DESC LIMIT 1
                    ''', (student_id,))
                    open_session = row_to_dict(cursor.fetchone())

                    # Decidir l'acció: si requested_action és 'auto', depèn de si té sessió oberta
                    should_checkin = (requested_action == 'entrada') or (requested_action == 'auto' and not open_session)
                    should_checkout = (requested_action == 'sortida') or (requested_action == 'auto' and open_session)

                    if should_checkin:
                        # INICIAR ENTRADA (Check-in)
                        # Si ja en tenia una d'oberta i forcem nova entrada, tanquem la prèvia per seguretat
                        if open_session:
                            cursor.execute('UPDATE sessions SET estat = "tancada_forçada", notes = "Reemplaçada per nova entrada manual" WHERE id = ?', (open_session['id'],))

                        session_id = f"SES-{datetime.now().strftime('%Y%m%d%H%M%S')}-{student_id}"
                        cursor.execute('''
                            INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat, notes)
                            VALUES (?, ?, ?, ?, NULL, 0, '00:00:00', ?, 'oberta', '')
                        ''', (session_id, student_id, today, now_iso, tipus))
                        conn.commit()

                        # Sincronitzar nova sessió oberta a Google Sheets
                        sync_to_google_sheets_async('checkin', {
                            'id': session_id,
                            'student_id': student_id,
                            'data': today,
                            'entrada': now_iso,
                            'sortida': '',
                            'durada_segons': 0,
                            'format_hms': '00:00:00',
                            'tipus': tipus,
                            'estat': 'oberta',
                            'notes': ''
                        })

                        balanc = get_student_balance(student_id)
                        self.send_json({
                            'ok': True,
                            'action': 'entrada',
                            'alumne': student,
                            'horaEntrada': now.strftime('%H:%M:%S'),
                            'dataEntrada': now.strftime('%d/%m/%Y'),
                            'balanc': balanc,
                            'message': f"Entrada registrada per a {student['nom']} a les {now.strftime('%H:%M:%S')} ({tipus.upper()})."
                        })
                        return

                    elif should_checkout:
                        # REGISTRAR SORTIDA (Check-out)
                        if not open_session:
                            self.send_json({
                                'ok': False,
                                'error': f"{student['nom']} no té cap entrada activa registrada. Per registrar una classe passada utilitza 'Sessió Manual'."
                            }, 400)
                            return

                        entrada_dt = datetime.fromisoformat(open_session['entrada'])
                        diff = now - entrada_dt
                        durada_segons = max(0, int(diff.total_seconds()))
                        durada_hms = format_hms(durada_segons)

                        cursor.execute('''
                            UPDATE sessions 
                            SET sortida = ?, durada_segons = ?, format_hms = ?, estat = 'tancada', tipus = ?
                            WHERE id = ?
                        ''', (now_iso, durada_segons, durada_hms, tipus, open_session['id']))
                        conn.commit()

                        # Sincronitzar sortida a Google Sheets
                        sync_to_google_sheets_async('checkout', {
                            'id': open_session['id'],
                            'student_id': student_id,
                            'data': open_session['data'],
                            'entrada': open_session['entrada'],
                            'sortida': now_iso,
                            'durada_segons': durada_segons,
                            'format_hms': durada_hms,
                            'tipus': tipus,
                            'estat': 'tancada',
                            'notes': open_session.get('notes', '')
                        })

                        balanc = get_student_balance(student_id)
                        self.send_json({
                            'ok': True,
                            'action': 'sortida',
                            'alumne': student,
                            'horaEntrada': entrada_dt.strftime('%H:%M:%S'),
                            'horaSortida': now.strftime('%H:%M:%S'),
                            'duradaSegons': durada_segons,
                            'duradaHms': durada_hms,
                            'balanc': balanc,
                            'message': f"Sortida registrada per a {student['nom']} a les {now.strftime('%H:%M:%S')}. Temps: {durada_hms}. Nou saldo: {balanc['formatBalance']}."
                        })
                        return

            elif path == '/api/tancar-cicle':
                # Tancar un cicle/sessió que l'alumne s'ha oblidat de marcar
                session_id = data.get('sessionId')
                student_id = data.get('studentId')
                durada_manual = data.get('duradaManual') # opcional: "01:30:00" o segons
                sortida_manual = data.get('sortidaManual') # opcional: ISO string
                notes = data.get('notes') or 'Tancat per oblit'

                with get_db() as conn:
                    cursor = conn.cursor()
                    if session_id:
                        cursor.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
                    elif student_id:
                        cursor.execute('SELECT * FROM sessions WHERE student_id = ? AND estat = "oberta" ORDER BY entrada DESC LIMIT 1', (student_id,))
                    else:
                        self.send_json({'ok': False, 'error': 'Cal indicar sessionId o studentId'}, 400)
                        return

                    sess = row_to_dict(cursor.fetchone())
                    if not sess:
                        self.send_json({'ok': False, 'error': 'No s\'ha trobat cap sessió oberta'}, 404)
                        return

                    entrada_dt = datetime.fromisoformat(sess['entrada'])

                    # Determinar sortida i durada
                    if durada_manual:
                        # duradaManual pot ser "01:30:00" o número de segons
                        if isinstance(durada_manual, (int, float)):
                            durada_segons = int(durada_manual)
                        else:
                            parts = [int(p) for p in str(durada_manual).split(':')]
                            if len(parts) == 3:
                                durada_segons = parts[0]*3600 + parts[1]*60 + parts[2]
                            elif len(parts) == 2:
                                durada_segons = parts[0]*3600 + parts[1]*60
                            else:
                                durada_segons = parts[0]*3600
                        sortida_dt = datetime.fromtimestamp(entrada_dt.timestamp() + durada_segons)
                        sortida_iso = sortida_dt.isoformat()
                    elif sortida_manual:
                        sortida_dt = datetime.fromisoformat(sortida_manual)
                        durada_segons = max(0, int((sortida_dt - entrada_dt).total_seconds()))
                        sortida_iso = sortida_manual
                    else:
                        # Per defecte: durada configurada al taller (1h 30m = 5400 segons)
                        cursor.execute('SELECT valor FROM configuracio WHERE clau = "hores_per_defecte_oblit"')
                        cfg_row = cursor.fetchone()
                        def_dur = cfg_row['valor'] if cfg_row else "01:30:00"
                        parts = [int(p) for p in def_dur.split(':')]
                        durada_segons = parts[0]*3600 + parts[1]*60 + (parts[2] if len(parts) > 2 else 0)
                        sortida_dt = datetime.fromtimestamp(entrada_dt.timestamp() + durada_segons)
                        sortida_iso = sortida_dt.isoformat()

                    durada_hms = format_hms(durada_segons)

                    cursor.execute('''
                        UPDATE sessions 
                        SET sortida = ?, durada_segons = ?, format_hms = ?, estat = 'tancada_forçada', notes = ?
                        WHERE id = ?
                    ''', (sortida_iso, durada_segons, durada_hms, notes, sess['id']))
                    conn.commit()

                    # Sincronitzar tancament forçat a Google Sheets
                    sync_to_google_sheets_async('force_close', {
                        'id': sess['id'],
                        'student_id': sess['student_id'],
                        'data': sess['data'],
                        'entrada': sess['entrada'],
                        'sortida': sortida_iso,
                        'durada_segons': durada_segons,
                        'format_hms': durada_hms,
                        'tipus': sess.get('tipus', 'manual'),
                        'estat': 'tancada_forçada',
                        'notes': notes
                    })

                    balanc = get_student_balance(sess['student_id'])

                self.send_json({
                    'ok': True,
                    'message': f"Cicle tancat correctament ({durada_hms})",
                    'duradaHms': durada_hms,
                    'balanc': balanc
                })
                return

            elif path == '/api/paquets':
                # Afegir compra de paquet d'hores
                student_id = data.get('studentId')
                hores = float(data.get('hores', 0))
                concepte = data.get('concepte') or f"Pack {hores} Hores"
                preu = float(data.get('preu', 0))
                metode = data.get('metodePagament') or 'Efectiu'
                stripe_session_id = data.get('stripeSessionId') or ''
                notes = data.get('notes') or ''
                data_compra = data.get('data') or datetime.now().isoformat()

                if not student_id or hores <= 0:
                    self.send_json({'ok': False, 'error': 'Cal indicar alumne i hores superiors a 0'}, 400)
                    return

                segons = int(round(hores * 3600))
                pack_id = f"PK-{datetime.now().strftime('%Y%m%d%H%M%S')}-{student_id}"

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament, stripe_session_id, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (pack_id, student_id, data_compra, hores, segons, concepte, preu, metode, stripe_session_id, notes))
                    conn.commit()

                # Sincronitzar compra d'hores a Google Sheets
                sync_to_google_sheets_async('add_paquet', {
                    'id': pack_id,
                    'student_id': student_id,
                    'data': data_compra,
                    'hores': hores,
                    'segons': segons,
                    'concepte': concepte,
                    'preu': preu,
                    'metode_pagament': metode,
                    'notes': notes
                })

                balanc = get_student_balance(student_id)

                self.send_json({
                    'ok': True,
                    'id': pack_id,
                    'message': f"S'han afegit {hores} hores ({format_hms(segons)}) a l'alumne.",
                    'balanc': balanc
                })
                return

            elif path == '/api/sessions/manual':
                # Creació o edició manual de sessió
                sess_id = data.get('id')
                student_id = data.get('studentId')
                data_sess = data.get('data') or datetime.now().strftime('%Y-%m-%d')
                entrada = data.get('entrada')
                sortida = data.get('sortida')
                notes = data.get('notes') or ''

                if not student_id or not entrada or not sortida:
                    self.send_json({'ok': False, 'error': 'Cal indicar alumne, hora d\'entrada i hora de sortida'}, 400)
                    return

                entrada_dt = datetime.fromisoformat(entrada)
                sortida_dt = datetime.fromisoformat(sortida)
                durada_segons = max(0, int((sortida_dt - entrada_dt).total_seconds()))
                durada_hms = format_hms(durada_segons)

                with get_db() as conn:
                    cursor = conn.cursor()
                    if sess_id:
                        cursor.execute('''
                            UPDATE sessions 
                            SET data = ?, entrada = ?, sortida = ?, durada_segons = ?, format_hms = ?, notes = ?, estat = 'tancada'
                            WHERE id = ?
                        ''', (data_sess, entrada, sortida, durada_segons, durada_hms, notes, sess_id))
                    else:
                        sess_id = f"SES-MANUAL-{datetime.now().strftime('%Y%m%d%H%M%S')}-{student_id}"
                        cursor.execute('''
                            INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 'tancada', ?)
                        ''', (sess_id, student_id, data_sess, entrada, sortida, durada_segons, durada_hms, notes))
                    conn.commit()

                # Sincronitzar sessió manual a Google Sheets
                sync_to_google_sheets_async('manual_session', {
                    'id': sess_id,
                    'student_id': student_id,
                    'data': data_sess,
                    'entrada': entrada,
                    'sortida': sortida,
                    'durada_segons': durada_segons,
                    'format_hms': durada_hms,
                    'tipus': 'manual',
                    'estat': 'tancada',
                    'notes': notes
                })

                balanc = get_student_balance(student_id)

                self.send_json({
                    'ok': True,
                    'id': sess_id,
                    'duradaHms': durada_hms,
                    'balanc': balanc,
                    'message': 'Sessió desada correctament'
                })
                return

            elif path == '/api/reserves':
                student_id = (data.get('student_id') or data.get('studentId') or '').strip()
                data_res = (data.get('data') or data.get('dataReserva') or '').strip()
                franja_id = (data.get('franja_id') or data.get('franjaId') or data.get('franja') or '').strip()
                activitat_id = (data.get('activitat_id') or data.get('activitatId') or 'torn').strip().lower()
                activitat_nom = (data.get('activitat') or '').strip()
                places_demanades = int(data.get('places') or data.get('numPersones') or 1)
                if places_demanades < 1:
                    places_demanades = 1
                notes = (data.get('notes') or '').strip()
                student_nom = (data.get('student_nom') or data.get('studentNom') or data.get('nom') or '').strip()
                telefon = (data.get('telefon') or '').strip()

                if not student_id or not data_res or not franja_id:
                    self.send_json({'ok': False, 'error': 'Cal indicar alumne, data i franja horària'}, 400)
                    return

                # Validar dia tancat (dilluns/dimarts descans, festiu o vacances)
                estat_dia = is_dia_tancat(data_res)
                if estat_dia['tancat']:
                    self.send_json({'ok': False, 'error': estat_dia['motiu']}, 400)
                    return

                act_obj = next((a for a in ACTIVITATS if a['id'] == activitat_id or a['nom'].lower() == activitat_id or a['nom'].lower() == activitat_nom.lower()), None)
                if not act_obj:
                    act_obj = ACTIVITATS[0]
                activitat_id = act_obj['id']
                activitat_nom = act_obj['nom']

                franges = get_franges_config()
                franja_obj = next((f for f in franges if f['id'] == franja_id or f['nom'] == franja_id), None)
                if not franja_obj:
                    franja_obj = {"id": franja_id, "nom": franja_id, "inici": "10:00", "fi": "11:30", "hores": 1.5}

                with get_db() as conn:
                    cursor = conn.cursor()
                    if not student_nom or not telefon:
                        cursor.execute('SELECT nom, cognoms, telefon FROM alumnes WHERE id = ?', (student_id,))
                        al = cursor.fetchone()
                        if al:
                            if not student_nom:
                                student_nom = f"{al['nom']} {al['cognoms'] or ''}".strip()
                            if not telefon and al['telefon']:
                                telefon = str(al['telefon']).strip()
                        else:
                            if not student_nom:
                                student_nom = student_id

                    # Comprovar si l'alumne ja té reserva confirmada per a aquesta franja del mateix dia
                    cursor.execute('''
                        SELECT id FROM reserves 
                        WHERE student_id = ? AND data = ? AND franja = ? AND estat = 'confirmada'
                    ''', (student_id, data_res, franja_obj['id']))
                    if cursor.fetchone():
                        self.send_json({'ok': False, 'error': 'Ja tens una reserva confirmada per a aquesta franja.'}, 400)
                        return

                    # Comprovar aforament global de la franja (màxim 12 places en total)
                    max_cap = get_aforament_maxim()
                    cursor.execute('''
                        SELECT SUM(COALESCE(places, 1)) as total_ocupades FROM reserves
                        WHERE data = ? AND franja = ? AND estat = 'confirmada'
                    ''', (data_res, franja_obj['id']))
                    r_ocup = cursor.fetchone()
                    current_ocupat_franja = r_ocup['total_ocupades'] or 0
                    if current_ocupat_franja + places_demanades > max_cap:
                        lliures = max(0, max_cap - current_ocupat_franja)
                        self.send_json({'ok': False, 'error': f"Aforament complet de la franja. Queden {lliures} places lliures (Màx. {max_cap})."}, 400)
                        return

                    # Comprovar aforament particular de l'activitat
                    cursor.execute('''
                        SELECT SUM(COALESCE(places, 1)) as act_ocupades FROM reserves
                        WHERE data = ? AND franja = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat = 'confirmada'
                    ''', (data_res, franja_obj['id'], activitat_id, activitat_nom.lower()))
                    r_act = cursor.fetchone()
                    current_ocupat_act = r_act['act_ocupades'] or 0
                    if current_ocupat_act + places_demanades > act_obj['capacitatMax']:
                        lliures_act = max(0, act_obj['capacitatMax'] - current_ocupat_act)
                        self.send_json({'ok': False, 'error': f"No hi ha prou places per a {activitat_nom}. Queden {lliures_act} places d'aquesta activitat (Màx. {act_obj['capacitatMax']})."}, 400)
                        return

                    res_id = f"RES-{int(datetime.now().timestamp())}-{student_id}"
                    now_iso = datetime.now().isoformat()
                    cal_event_id = (data.get('calendar_event_id') or '').strip() or None
                    cursor.execute('''
                        INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, estat, hores, notes, created_at, calendar_event_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?, ?, ?, ?)
                    ''', (
                        res_id, student_id, student_nom, data_res,
                        franja_obj.get('inici', '10:00'), franja_obj.get('fi', '11:30'),
                        franja_obj['id'], activitat_nom, activitat_id, places_demanades, telefon,
                        float(franja_obj.get('hores', 1.5)), notes, now_iso, cal_event_id
                    ))
                    conn.commit()

                # Obtenir nom del calendari configurat
                cal_name = 'Roig de Coure'
                with get_db() as conn:
                    c_cursor = conn.cursor()
                    c_cursor.execute("SELECT valor FROM configuracio WHERE clau = 'google_calendar_name'")
                    c_row = c_cursor.fetchone()
                    if c_row and c_row['valor']:
                        cal_name = c_row['valor']

                reserva_dict = {
                    'id': res_id,
                    'student_id': student_id,
                    'student_nom': student_nom,
                    'telefon': telefon,
                    'data': data_res,
                    'hora_inici': franja_obj.get('inici', '10:00'),
                    'hora_fi': franja_obj.get('fi', '11:30'),
                    'franja': franja_obj['id'],
                    'franja_nom': franja_obj.get('nom'),
                    'activitat': activitat_nom,
                    'activitat_id': activitat_id,
                    'places': places_demanades,
                    'estat': 'confirmada',
                    'hores': float(franja_obj.get('hores', 1.5)),
                    'notes': notes,
                    'created_at': now_iso,
                    'calendar_event_id': cal_event_id,
                    'calendar_name': cal_name
                }

                # Sincronitzar reserva a Google Sheets i Google Calendar
                sync_to_google_sheets_async('add_reserva', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': 'Reserva confirmada correctament!',
                    'reserva': reserva_dict
                })
                return

            elif path == '/api/reserves/cancel':
                res_id = (data.get('id') or '').strip()
                if not res_id:
                    self.send_json({'ok': False, 'error': 'Cal indicar l\'ID de la reserva'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM reserves WHERE id = ?', (res_id,))
                    row = cursor.fetchone()
                    if not row:
                        self.send_json({'ok': False, 'error': 'Reserva no trobada'}, 404)
                        return

                    cursor.execute("UPDATE reserves SET estat = 'cancel·lada' WHERE id = ?", (res_id,))
                    conn.commit()
                    reserva_dict = row_to_dict(row)
                    reserva_dict['estat'] = 'cancel·lada'

                # Sincronitzar cancel·lació a Google Sheets
                sync_to_google_sheets_async('cancel_reserva', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': 'Reserva cancel·lada correctament i plaça alliberada.',
                    'reserva': reserva_dict
                })
                return

            elif path == '/api/reserves/config-aforament':
                aforament = int(data.get('aforamentMaxim') or data.get('aforament_maxim') or 8)
                if aforament < 1:
                    aforament = 1
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', ('aforament_maxim_per_franja', str(aforament)))
                    conn.commit()

                sync_to_google_sheets_async('save_config', {'aforament_maxim_per_franja': str(aforament)})
                self.send_json({'ok': True, 'aforamentMaxim': aforament, 'message': f'Aforament màxim actualitzat a {aforament} places.'})
                return

            elif path == '/api/config':
                # Desar paràmetres de configuració
                cfg_items = data.items()
                with get_db() as conn:
                    cursor = conn.cursor()
                    for k, v in cfg_items:
                        cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))
                    conn.commit()

                # Sincronitzar canvis de configuració i disseny a Google Sheets
                sync_to_google_sheets_async('save_config', dict(cfg_items))

                self.send_json({'ok': True, 'message': 'Configuració actualitzada'})
                return

            elif path == '/api/import':
                # Restauració de backup
                alumnes = data.get('alumnes', [])
                paquets = data.get('paquets', [])
                sessions = data.get('sessions', [])
                reserves = data.get('reserves', [])
                config = data.get('config', {})

                with get_db() as conn:
                    cursor = conn.cursor()
                    for a in alumnes:
                        cursor.execute('''
                            INSERT OR REPLACE INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (a['id'], a['nom'], a['cognoms'], a.get('telefon'), a.get('email'), a.get('pin'), a['data_alta'], a.get('notes'), a.get('actiu', 1)))

                    for p in paquets:
                        cursor.execute('''
                            INSERT OR REPLACE INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament, stripe_session_id, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (p['id'], p['student_id'], p['data'], p['hores'], p['segons'], p.get('concepte'), p.get('preu', 0), p.get('metode_pagament'), p.get('stripe_session_id'), p.get('notes')))

                    for s in sessions:
                        cursor.execute('''
                            INSERT OR REPLACE INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (s['id'], s['student_id'], s['data'], s['entrada'], s.get('sortida'), s.get('durada_segons', 0), s.get('format_hms'), s.get('tipus', 'qr'), s.get('estat', 'oberta'), s.get('notes')))

                    for r in reserves:
                        cursor.execute('''
                            INSERT OR REPLACE INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, estat, hores, notes, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (r['id'], r['student_id'], r.get('student_nom', ''), r['data'], r.get('hora_inici', '10:00'), r.get('hora_fi', '12:00'), r.get('franja', 'mati_1'), r.get('estat', 'confirmada'), float(r.get('hores', 2.0)), r.get('notes', ''), r.get('created_at', datetime.now().isoformat())))

                    for k, v in config.items():
                        cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))

                    conn.commit()
                self.send_json({'ok': True, 'message': 'Dades restaurades amb èxit'})
                return

            elif path == '/api/sync/hydrate':
                # Re-hidratació manual des de Google Sheets
                custom_url = data.get('url') if data else None
                res = hydrate_from_google_sheets(custom_url)
                self.send_json(res, 200 if res.get('ok') else 400)
                return

            elif path == '/api/sync/all':
                # Enviar totes les dades locals a Google Sheets
                url = get_google_sheets_url()
                if not url:
                    self.send_json({'ok': False, 'error': 'No hi ha cap URL de Google Sheets configurat'}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM alumnes')
                    alumnes_all = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM paquets_hores')
                    paquets_all = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM sessions')
                    sessions_all = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM reserves')
                    reserves_all = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT clau, valor FROM configuracio')
                    cfg_all = {r['clau']: r['valor'] for r in cursor.fetchall()}

                sync_to_google_sheets_async('sync_all', {
                    'alumnes': alumnes_all,
                    'paquets': paquets_all,
                    'sessions': sessions_all,
                    'reserves': reserves_all,
                    'config': cfg_all
                })
                self.send_json({'ok': True, 'message': 'Sincronització completa enviada a Google Sheets en segon pla.'})
                return

            else:
                self.send_json({'ok': False, 'error': 'Ruta API no trobada'}, 404)

        except Exception as e:
            self.send_json({'ok': False, 'error': str(e)}, 500)

    def do_DELETE(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        try:
            if path.startswith('/api/alumnes/'):
                student_id = path.replace('/api/alumnes/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('UPDATE alumnes SET actiu = 0 WHERE id = ?', (student_id,))
                    conn.commit()

                sync_to_google_sheets_async('sync_alumne', {'id': student_id, 'actiu': 0})
                self.send_json({'ok': True, 'message': 'Alumne desactivat correctament'})
                return

            elif path.startswith('/api/sessions/'):
                session_id = path.replace('/api/sessions/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT student_id FROM sessions WHERE id = ?', (session_id,))
                    r = cursor.fetchone()
                    student_id = r['student_id'] if r else None
                    cursor.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
                    conn.commit()
                    balanc = get_student_balance(student_id) if student_id else None

                sync_to_google_sheets_async('delete_session', {'id': session_id})
                self.send_json({'ok': True, 'message': 'Sessió eliminada', 'balanc': balanc})
                return

            elif path.startswith('/api/reserves/'):
                res_id = path.replace('/api/reserves/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM reserves WHERE id = ?', (res_id,))
                    row = cursor.fetchone()
                    cursor.execute('DELETE FROM reserves WHERE id = ?', (res_id,))
                    conn.commit()

                if row:
                    sync_to_google_sheets_async('delete_reserva', {'id': res_id})
                self.send_json({'ok': True, 'message': 'Reserva eliminada'})
                return

            elif path.startswith('/api/paquets/'):
                pack_id = path.replace('/api/paquets/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT student_id FROM paquets_hores WHERE id = ?', (pack_id,))
                    r = cursor.fetchone()
                    student_id = r['student_id'] if r else None
                    cursor.execute('DELETE FROM paquets_hores WHERE id = ?', (pack_id,))
                    conn.commit()
                    balanc = get_student_balance(student_id) if student_id else None

                sync_to_google_sheets_async('delete_paquet', {'id': pack_id})
                self.send_json({'ok': True, 'message': 'Paquet eliminat', 'balanc': balanc})
                return

            else:
                self.send_json({'ok': False, 'error': 'Ruta API no trobada'}, 404)
        except Exception as e:
            self.send_json({'ok': False, 'error': str(e)}, 500)

def run_server():
    server_address = ('', PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, CeramicsRequestHandler)

    # Obtenir IP local de la xarxa
    local_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print("=" * 65)
    print("🏺 SERVIDOR DEL TALLER DE CERÀMICA ACTIU (SQLite + REST API)")
    print("=" * 65)
    print(f"📍 Local (aquest ordinador):   http://localhost:{PORT}")
    print(f"📱 Mòbil / Tauleta (mateixa WiFi): http://{local_ip}:{PORT}")
    print(f"🛠️  Panell Administració:       http://localhost:{PORT}/admin.html")
    print(f"📷 Escàner QR (Android/Tauleta): http://localhost:{PORT}/scanner.html")
    print(f"👤 Portal de l'Alumne:         http://localhost:{PORT}/alumne.html")
    print(f"🗄️  Base de Dades SQLite:        {DB_PATH}")
    print("=" * 65)
    print("Prem Ctrl+C per aturar el servidor.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nAturant servidor...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
