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
import urllib.parse
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
                actiu INTEGER DEFAULT 1
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
        # Taula de configuració
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS configuracio (
                clau TEXT PRIMARY KEY,
                valor TEXT
            )
        ''')

        # Valors de configuració inicials per defecte si no existeixen
        default_config = {
            'taller_nom': "Taller de Ceràmica",
            'taller_telefon': "+34 600 000 000",
            'taller_email': "info@tallerdecoramica.cat",
            'hores_per_defecte_oblit': "01:30:00",
            'stripe_pack5_url': "",
            'stripe_pack10_url': "",
            'stripe_pack20_url': "",
            'google_sheets_url': ""
        }
        for k, v in default_config.items():
            cursor.execute('INSERT OR IGNORE INTO configuracio (clau, valor) VALUES (?, ?)', (k, v))

        # Dades inicials de demostració si la base de dades és buida
        cursor.execute('SELECT COUNT(*) as count FROM alumnes')
        if cursor.fetchone()['count'] == 0:
            now_iso = datetime.now().isoformat()
            demo_students = [
                ('TC-101', 'Maria', 'Garcia Font', '612345678', 'maria.garcia@email.com', '1001', now_iso, 'Curs de torn nivell mig', 1),
                ('TC-102', 'Jordi', 'Rovira Pons', '623456789', 'jordi.rovira@email.com', '1002', now_iso, 'Modelatge i escultura', 1),
                ('TC-103', 'Clara', 'Vidal Soler', '634567890', 'clara.vidal@email.com', '1003', now_iso, 'Esmalts i pintura', 1)
            ]
            cursor.executemany('''
                INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    cursor.execute('SELECT * FROM configuracio')
                    config = {r['clau']: r['valor'] for r in cursor.fetchall()}
                self.send_json({
                    'versio': '1.0',
                    'timestamp': datetime.now().isoformat(),
                    'alumnes': alumnes,
                    'paquets': paquets,
                    'sessions': sessions,
                    'config': config
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
                        INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                        ON CONFLICT(id) DO UPDATE SET
                            nom=excluded.nom,
                            cognoms=excluded.cognoms,
                            telefon=excluded.telefon,
                            email=excluded.email,
                            pin=excluded.pin,
                            notes=excluded.notes
                    ''', (student_id, nom, cognoms, telefon, email, pin, data_alta, notes))
                    conn.commit()

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

                    if not open_session:
                        # INICIAR ENTRADA (Check-in)
                        session_id = f"SES-{datetime.now().strftime('%Y%m%d%H%M%S')}-{student_id}"
                        cursor.execute('''
                            INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat, notes)
                            VALUES (?, ?, ?, ?, NULL, 0, '00:00:00', 'qr', 'oberta', '')
                        ''', (session_id, student_id, today, now_iso))
                        conn.commit()

                        balanc = get_student_balance(student_id)
                        self.send_json({
                            'ok': True,
                            'action': 'entrada',
                            'alumne': student,
                            'horaEntrada': now.strftime('%H:%M:%S'),
                            'dataEntrada': now.strftime('%d/%m/%Y'),
                            'balanc': balanc,
                            'message': f"Benvingut/da {student['nom']}! Entrada registrada a les {now.strftime('%H:%M:%S')}."
                        })
                        return
                    else:
                        # REGISTRAR SORTIDA (Check-out)
                        entrada_dt = datetime.fromisoformat(open_session['entrada'])
                        diff = now - entrada_dt
                        durada_segons = max(0, int(diff.total_seconds()))
                        durada_hms = format_hms(durada_segons)

                        cursor.execute('''
                            UPDATE sessions 
                            SET sortida = ?, durada_segons = ?, format_hms = ?, estat = 'tancada'
                            WHERE id = ?
                        ''', (now_iso, durada_segons, durada_hms, open_session['id']))
                        conn.commit()

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
                            'message': f"Fins aviat {student['nom']}! Has estat {durada_hms}. Saldo disponible: {balanc['formatBalance']}."
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
                    balanc = get_student_balance(student_id)

                self.send_json({
                    'ok': True,
                    'id': sess_id,
                    'duradaHms': durada_hms,
                    'balanc': balanc,
                    'message': 'Sessió desada correctament'
                })
                return

            elif path == '/api/config':
                # Desar paràmetres de configuració
                cfg_items = data.items()
                with get_db() as conn:
                    cursor = conn.cursor()
                    for k, v in cfg_items:
                        cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Configuració actualitzada'})
                return

            elif path == '/api/import':
                # Restauració de backup
                alumnes = data.get('alumnes', [])
                paquets = data.get('paquets', [])
                sessions = data.get('sessions', [])
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

                    for k, v in config.items():
                        cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))

                    conn.commit()
                self.send_json({'ok': True, 'message': 'Dades restaurades amb èxit'})
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
                self.send_json({'ok': True, 'message': 'Sessió eliminada', 'balanc': balanc})
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
