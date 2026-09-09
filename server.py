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
import hashlib
import io
import zipfile
import sys
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
import ssl
from datetime import datetime, timedelta, timezone, date

try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo("Europe/Madrid")
except Exception:
    LOCAL_TZ = None

def get_now():
    """
    Retorna la data i hora actual a la zona horària oficial del taller (Europe/Madrid).
    Evita el desplaçament d'1 o 2 hores quan el servidor s'executa a plataformes al núvol (Render, Docker, etc.) en UTC.
    Retorna un datetime naive que conté exactament l'hora local de Catalunya.
    """
    if LOCAL_TZ is not None:
        try:
            return datetime.now(LOCAL_TZ).replace(tzinfo=None)
        except Exception:
            pass

    utcnow = datetime.now(timezone.utc)
    year = utcnow.year
    d_mar = datetime(year, 3, 31, 1, 0, tzinfo=timezone.utc)
    start_dst = d_mar - timedelta(days=(d_mar.weekday() + 1) % 7)
    d_oct = datetime(year, 10, 31, 1, 0, tzinfo=timezone.utc)
    end_dst = d_oct - timedelta(days=(d_oct.weekday() + 1) % 7)
    is_dst = start_dst <= utcnow < end_dst
    offset = timedelta(hours=2 if is_dst else 1)
    return (utcnow + offset).replace(tzinfo=None)

def parse_to_local_dt(dt_str):
    """
    Converteix qualsevol cadena de data/hora (amb o sense Z, amb o sense offset)
    a datetime local naive a Europe/Madrid.
    """
    if not dt_str:
        return get_now()
    s = str(dt_str).strip()
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            if LOCAL_TZ:
                return dt.astimezone(LOCAL_TZ).replace(tzinfo=None)
            else:
                dt_utc = dt.astimezone(timezone.utc)
                year = dt_utc.year
                d_mar = datetime(year, 3, 31, 1, 0, tzinfo=timezone.utc)
                start_dst = d_mar - timedelta(days=(d_mar.weekday() + 1) % 7)
                d_oct = datetime(year, 10, 31, 1, 0, tzinfo=timezone.utc)
                end_dst = d_oct - timedelta(days=(d_oct.weekday() + 1) % 7)
                is_dst = start_dst <= dt_utc < end_dst
                offset = timedelta(hours=2 if is_dst else 1)
                return (dt_utc + offset).replace(tzinfo=None)
        return dt
    except Exception:
        return get_now()

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get('PORT', 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'data', 'ceramica.db')

# Assegurar directoris data/ i data/backups/
os.makedirs(os.path.join(BASE_DIR, 'data'), exist_ok=True)
BACKUP_DIR = os.path.join(BASE_DIR, 'data', 'backups')
os.makedirs(BACKUP_DIR, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn

def clean_old_backups(days=30):
    """Purga automàticament els fitxers de còpia més antics de X dies."""
    try:
        if not os.path.exists(BACKUP_DIR):
            return
        now_ts = time.time()
        max_age = days * 86400
        for f in os.listdir(BACKUP_DIR):
            if f.endswith('.db'):
                fp = os.path.join(BACKUP_DIR, f)
                if os.path.isfile(fp) and (now_ts - os.path.getmtime(fp)) > max_age:
                    try:
                        os.remove(fp)
                    except Exception:
                        pass
    except Exception as e:
        print(f"[Backup] Error netejant backups antics: {e}")

def create_daily_snapshot_if_needed():
    """Crea una còpia de seguretat SQLite del dia d'avui si encara no existeix."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        today_str = get_now().strftime('%Y-%m-%d')
        daily_path = os.path.join(BACKUP_DIR, f"ceramica_{today_str}.db")
        if not os.path.exists(daily_path) and os.path.exists(DB_PATH):
            with get_db() as src_conn:
                dest_conn = sqlite3.connect(daily_path)
                src_conn.backup(dest_conn)
                dest_conn.close()
            clean_old_backups(30)
    except Exception as e:
        print(f"[Backup] Error creant snapshot diari: {e}")

def create_manual_snapshot(prefix="ceramica_manual"):
    """Crea un snapshot de la base de dades a petició."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = get_now().strftime('%Y%m%d_%H%M%S')
    filename = f"{prefix}_{ts}.db"
    dest_path = os.path.join(BACKUP_DIR, filename)
    with get_db() as src_conn:
        dest_conn = sqlite3.connect(dest_path)
        src_conn.backup(dest_conn)
        dest_conn.close()
    return filename

def verify_admin_pin(input_pin):
    """Verifica si el PIN facilitat coincideix amb el PIN configurat a la BD o env."""
    if not input_pin:
        return False
    configured_pin = None
    env_pin = os.environ.get('ADMIN_PIN')
    if env_pin:
        configured_pin = env_pin.strip()
    else:
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT valor FROM configuracio WHERE clau = 'admin_pin'")
                row = cursor.fetchone()
                if row and row['valor']:
                    configured_pin = str(row['valor']).strip()
        except Exception:
            pass
    if not configured_pin:
        configured_pin = '1234'
    return str(input_pin).strip() == configured_pin

def calculate_age_from_birthdate(birthdate_str):
    """Calcula l'edat exacta en anys a partir de la data de naixement."""
    if not birthdate_str:
        return None
    try:
        s = str(birthdate_str).strip()
        if not s:
            return None
        if '/' in s:
            parts = s.split('/')
            if len(parts) == 3:
                born = datetime(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                return None
        else:
            parts = s.split('-')
            if len(parts) == 3:
                born = datetime(int(parts[0]), int(parts[1]), int(parts[2][:2]))
            else:
                return None
        today = datetime.now()
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        return age if age >= 0 else None
    except Exception:
        return None

DEFAULT_CARNET_CONFIG = {
    "background_color": "#b1ffc2",
    "text_color": "#801b1b",
    "font_style": "borel",
    "show_bowl_logo": True,
    "custom_logo_svg": "",
    "show_divider": True,
    "brand_name": "Roig de Coure",
    "visible_fields": {
        "nom": True,
        "cognoms": True,
        "codi": True,
        "telefon": False,
        "saldo": False
    }
}

def get_carnet_config(conn=None):
    """
    Retorna la configuració de disseny del carnet emmagatzemada a la BD o la configuració per defecte.
    """
    cfg = dict(DEFAULT_CARNET_CONFIG)
    try:
        should_close = False
        if conn is None:
            conn = get_db()
            should_close = True
        cursor = conn.cursor()
        cursor.execute("SELECT valor FROM configuracio WHERE clau = 'carnet_design'")
        row = cursor.fetchone()
        if row and row['valor']:
            saved = json.loads(row['valor'])
            if isinstance(saved, dict):
                cfg.update(saved)
                if 'visible_fields' in saved and isinstance(saved['visible_fields'], dict):
                    merged_vis = dict(DEFAULT_CARNET_CONFIG['visible_fields'])
                    merged_vis.update(saved['visible_fields'])
                    cfg['visible_fields'] = merged_vis
        if should_close:
            conn.close()
    except Exception as e:
        print(f"[Carnet Config] Error llegint configuració: {e}")
    return cfg

def generate_carnet_svg(student, config=None):
    """
    Genera el codi SVG vectorial autònom del carnet d'alumne segons la configuració del taller.
    Format CR80 (proporció 1.586 : 1, 1012 x 638 px).
    """
    if not config:
        config = get_carnet_config()

    bg_color = config.get('background_color', '#b1ffc2')
    text_color = config.get('text_color', '#801b1b')
    brand_name = config.get('brand_name', 'Roig de Coure')
    font_style = config.get('font_style', 'borel')
    show_bowl = config.get('show_bowl_logo', True)
    custom_logo = config.get('custom_logo_svg', '')
    show_divider = config.get('show_divider', True)
    vis = config.get('visible_fields', {})

    nom = (student.get('nom') or 'Zoey').strip()
    cognoms = (student.get('cognoms') or '').strip()
    codi = (student.get('id') or '300Z').strip()
    telefon = (student.get('telefon') or '').strip()

    script_font = "'Borel', 'Buffalo', cursive" if font_style != 'modern' else "system-ui, -apple-system, sans-serif"

    # Silueta vectorial artesanal del bol ceràmic
    bowl_markup = ''
    if show_bowl:
        if custom_logo and '<svg' in custom_logo:
            bowl_markup = f'<g transform="translate(845, 52)">{custom_logo}</g>'
        else:
            bowl_markup = f'''
      <g transform="translate(845, 52)" fill="{text_color}">
        <path d="M 5 12 C 18 50, 50 56, 70 56 C 90 56, 122 50, 135 12 C 137 6, 128 6, 123 10 C 108 44, 88 48, 70 48 C 52 48, 32 44, 17 10 C 12 6, 3 6, 5 12 Z M 44 56 L 44 65 L 56 65 L 56 56 Z M 84 56 L 84 65 L 96 65 L 96 56 Z"/>
      </g>'''

    divider_markup = f'''<line x1="60" y1="435" x2="560" y2="435" stroke="{text_color}" stroke-width="2" stroke-dasharray="12, 8" opacity="0.65"/>''' if show_divider else ''

    tel_markup = f'''<text x="60" y="585" font-family="{script_font}" font-size="22" fill="{text_color}">Telèfon:</text><text x="160" y="585" font-family="Roboto, sans-serif" font-size="22" font-weight="600" fill="#1f1f1f">{telefon}</text>''' if vis.get('telefon') and telefon else ''

    # QR box amb representació vectorial neta
    qr_svg = f'''
    <g transform="translate(680, 240)">
      <rect x="0" y="0" width="260" height="260" rx="16" fill="#ffffff" stroke="{text_color}" stroke-width="2" filter="drop-shadow(0px 4px 10px rgba(0,0,0,0.08))"/>
      <!-- QR Finder Top-Left -->
      <rect x="25" y="25" width="55" height="55" fill="#000000" rx="6"/>
      <rect x="33" y="33" width="39" height="39" fill="#ffffff" rx="3"/>
      <rect x="41" y="41" width="23" height="23" fill="#000000" rx="2"/>
      <!-- QR Finder Top-Right -->
      <rect x="180" y="25" width="55" height="55" fill="#000000" rx="6"/>
      <rect x="188" y="33" width="39" height="39" fill="#ffffff" rx="3"/>
      <rect x="196" y="41" width="23" height="23" fill="#000000" rx="2"/>
      <!-- QR Finder Bottom-Left -->
      <rect x="25" y="180" width="55" height="55" fill="#000000" rx="6"/>
      <rect x="33" y="188" width="39" height="39" fill="#ffffff" rx="3"/>
      <rect x="41" y="196" width="23" height="23" fill="#000000" rx="2"/>
      <!-- QR Timing & Data Patterns -->
      <rect x="95" y="48" width="70" height="9" fill="#000000"/>
      <rect x="48" y="95" width="9" height="70" fill="#000000"/>
      <rect x="100" y="90" width="16" height="16" fill="#000000"/>
      <rect x="130" y="90" width="20" height="16" fill="#000000"/>
      <rect x="165" y="100" width="16" height="30" fill="#000000"/>
      <rect x="100" y="125" width="45" height="16" fill="#000000"/>
      <rect x="100" y="160" width="30" height="40" fill="#000000"/>
      <rect x="145" y="150" width="35" height="16" fill="#000000"/>
      <rect x="150" y="180" width="50" height="25" fill="#000000"/>
      <rect x="195" y="135" width="30" height="25" fill="#000000"/>
      <text x="130" y="235" font-family="Roboto, sans-serif" font-size="14" font-weight="700" fill="#1f1f1f" text-anchor="middle" letter-spacing="1">{codi}</text>
    </g>'''

    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1012 638" width="1012" height="638">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Borel&amp;family=Roboto:wght@400;500;700&amp;display=swap');
    </style>
  </defs>
  <!-- Fons de la targeta en proporció CR80 -->
  <rect x="0" y="0" width="1012" height="638" rx="28" ry="28" fill="{bg_color}" stroke="{text_color}" stroke-opacity="0.25" stroke-width="2"/>

  <!-- Marca Roig de Coure -->
  <text x="60" y="105" font-family="{script_font}" font-size="46" font-weight="bold" fill="{text_color}">{brand_name}</text>

  <!-- Bol de ceràmica artesanal -->
  {bowl_markup}

  <!-- Camps de l'Alumne -->
  <g transform="translate(0, 40)">
    <text x="60" y="175" font-family="{script_font}" font-size="30" fill="{text_color}">Nom:</text>
    <text x="60" y="230" font-family="Roboto, sans-serif" font-size="36" font-weight="500" fill="#1f1f1f">{nom}</text>

    <text x="60" y="300" font-family="{script_font}" font-size="30" fill="{text_color}">Cognoms:</text>
    <text x="60" y="355" font-family="Roboto, sans-serif" font-size="36" font-weight="500" fill="#1f1f1f">{cognoms if cognoms else '—'}</text>

    {divider_markup}

    <text x="60" y="450" font-family="{script_font}" font-size="30" fill="{text_color}">Codi Alumne:</text>
    <text x="60" y="515" font-family="Roboto, sans-serif" font-size="44" font-weight="700" fill="{text_color}">{codi}</text>

    {tel_markup}
  </g>

  <!-- Codi QR integrat -->
  {qr_svg}
</svg>'''
    return svg_content

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
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
                edat INTEGER DEFAULT NULL,
                data_naixement TEXT DEFAULT NULL
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
                hores REAL DEFAULT 2.0,
                notes TEXT,
                created_at TEXT NOT NULL,
                calendar_event_id TEXT DEFAULT NULL,
                recurrent_id TEXT DEFAULT NULL,
                FOREIGN KEY (student_id) REFERENCES alumnes (id)
            )
        ''')
        # Migració de columnes addicionals per a bases de dades existents
        for col, col_type in [
            ('telefon', "TEXT DEFAULT ''"),
            ('activitat_id', "TEXT DEFAULT 'torn'"),
            ('activitat', "TEXT DEFAULT 'Torn'"),
            ('places', "INTEGER DEFAULT 1"),
            ('email', "TEXT DEFAULT ''"),
            ('calendar_event_id', "TEXT DEFAULT NULL"),
            ('whatsapp_notif_confirm', "INTEGER DEFAULT 0"),
            ('whatsapp_notif_48h', "INTEGER DEFAULT 0"),
            ('whatsapp_notif_dia', "INTEGER DEFAULT 0"),
            ('val_regal', "INTEGER DEFAULT 0"),
            ('codi_val_regal', "TEXT DEFAULT ''"),
            ('recurrent_id', "TEXT DEFAULT NULL")
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

        # Migració de columna data_naixement a la taula alumnes si no existeix
        try:
            cursor.execute("ALTER TABLE alumnes ADD COLUMN data_naixement TEXT DEFAULT NULL")
        except Exception:
            pass

        # Taula de configuració
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS configuracio (
                clau TEXT PRIMARY KEY,
                valor TEXT
            )
        ''')

        # Franges horàries oficials: Torn únic de matí de 2 hores (Roig de Coure)
        default_franges_json = json.dumps([
            {"id": "M1", "nom": "Matí (10:00 - 13:00)", "inici": "10:00", "fi": "13:00", "hores": 2.0}
        ], ensure_ascii=False)

        # Valors de configuració inicials per defecte si no existeixen
        default_config = {
            'taller_nom': "Roig de Coure",
            'taller_subtitol': "Taller d'Art i Ceràmica",
            'taller_telefon': "+34 600 000 000",
            'taller_email': "roigdecoure@gmail.com",
            'taller_logo_url': "img/logo.png",
            'brand_primary': "#831D1D",
            'brand_secondary': "#5E7E6F",
            'brand_font': "serif",
            'brand_palette': "roigdecoure",
            'hores_per_defecte_oblit': "02:00:00",
            'stripe_url_adults': "https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n",
            'stripe_url_infantil': "https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j",
            'edat_tall_infantil': "12",
            'stripe_pack5_url': "",
            'stripe_pack10_url': "",
            'stripe_pack20_url': "",
            'google_sheets_url': "https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec",
            'google_calendar_name': "reserves",
            'aforament_maxim_per_franja': "12",
            'capacitat_max_torn': "4",
            'capacitat_max_modelatge': "8",
            'capacitat_max_pintar': "12",
            'whatsapp_enabled': "0",
            'whatsapp_meta_phone_id': "",
            'whatsapp_meta_token': "",
            'whatsapp_meta_template_confirmacio': "reserva_confirmada",
            'whatsapp_meta_template_recordatori_48h': "reserva_recordatori_48h",
            'whatsapp_meta_template_recordatori_dia': "reserva_recordatori_dia",
            'carnet_design': json.dumps(DEFAULT_CARNET_CONFIG, ensure_ascii=False),
            'franges_horaries': default_franges_json,
            'admin_pin': os.environ.get('ADMIN_PIN', '1234')
        }
        for k, v in default_config.items():
            cursor.execute('INSERT OR IGNORE INTO configuracio (clau, valor) VALUES (?, ?)', (k, v))

        # Migració de valors antics a configuració oficial si cal
        cursor.execute('UPDATE configuracio SET valor = "Roig de Coure" WHERE clau = "taller_nom" AND (valor = "Taller de Ceràmica" OR valor = "Taller de Ceramica" OR valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "#831D1D" WHERE clau = "brand_primary" AND (valor = "#C25E3A" OR valor = "#7A3026" OR valor IS NULL OR valor = "")')
        cursor.execute('UPDATE configuracio SET valor = "12" WHERE clau = "aforament_maxim_per_franja" AND (valor = "8" OR valor = "15" OR valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = ? WHERE clau = "franges_horaries" AND (valor LIKE "%mati_1%" OR valor LIKE "%F1%")', (default_franges_json,))
        cursor.execute('UPDATE configuracio SET valor = "02:00:00" WHERE clau = "hores_per_defecte_oblit" AND valor = "01:30:00"')
        cursor.execute('UPDATE configuracio SET valor = "https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n" WHERE clau = "stripe_url_adults" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j" WHERE clau = "stripe_url_infantil" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "12" WHERE clau = "edat_tall_infantil" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "reserves" WHERE clau = "google_calendar_name" AND (valor = "" OR valor IS NULL OR LOWER(REPLACE(valor, " ", "")) IN ("roigdecoure", "reserves"))')
        cursor.execute('UPDATE configuracio SET valor = "https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec" WHERE clau = "google_sheets_url" AND (valor = "" OR valor IS NULL OR valor LIKE "%AKfycbzfXuSg%")')
        cursor.execute("DELETE FROM reserves WHERE data LIKE '%GMT%' OR data LIKE '%Central European%' OR data LIKE '%hora de verano%' OR id = 'TEST-DEBUG-1'")

        # Assegurar persistència de l'alumne 231F (Ferran Picornell) de l'export oficial
        cursor.execute('''
            INSERT OR IGNORE INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu)
            VALUES ('231F', 'Ferran', 'Picornell', '+34683633880', '', '3880', '2026-01-01', 'Debe Recargar', 1)
        ''')

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
create_daily_snapshot_if_needed()

def get_google_sheets_url():
    """Obté l'URL de Google Sheets des de la base de dades (prioritari) o variable d'entorn (Render)"""
    NEW_DEFAULT_URL = "https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec"

    # 1. Comprovar base de dades (prioritari per si es canvia des d'admin.html)
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT valor FROM configuracio WHERE clau = 'google_sheets_url'")
            row = cursor.fetchone()
            if row and row['valor'] and row['valor'].strip():
                db_url = row['valor'].strip()
                if 'AKfycbzfXuSg' not in db_url:
                    return db_url
    except Exception:
        pass

    # 2. Variable d'entorn (Render), ignorant l'antiga URL obsoleta congelada
    env_url = os.environ.get('GOOGLE_SHEETS_URL', '').strip()
    if env_url and 'AKfycbzfXuSg' not in env_url:
        return env_url

    # 3. Fallback a la nova URL activa amb sincronització de Google Calendar
    return NEW_DEFAULT_URL

def sanitize_date_str(val):
    if not val:
        return ''
    s = str(val).strip()
    m = re.search(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    months = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
              'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}
    m2 = re.search(r'([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})', s)
    if m2 and m2.group(1) in months:
        return f"{int(m2.group(3)):04d}-{months[m2.group(1)]:02d}-{int(m2.group(2)):02d}"
    return s[:10]

def sanitize_time_str(val, default='10:00'):
    if not val:
        return default
    s = str(val).strip()
    m = re.search(r'(\d{1,2}):(\d{2})', s)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return default


def execute_safe_request(req, timeout=25):
    handlers = [urllib.request.HTTPRedirectHandler()]
    try:
        ctx = ssl.create_default_context()
        handlers.append(urllib.request.HTTPSHandler(context=ctx))
    except Exception:
        pass
    opener = urllib.request.build_opener(*handlers)
    try:
        return opener.open(req, timeout=timeout)
    except urllib.error.URLError as e:
        if 'CERTIFICATE_VERIFY_FAILED' in str(e):
            ctx_unverified = ssl._create_unverified_context()
            unverified_opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=ctx_unverified),
                urllib.request.HTTPRedirectHandler()
            )
            return unverified_opener.open(req, timeout=timeout)
        raise e

def hydrate_from_google_sheets(target_url=None):
    """
    Descàrrega inicial i bolcat (hidratació) des de Google Sheets cap a SQLite.
    Garanteix la persistència total a Render fins i tot després de reinicis de contenidor.
    """
    url = (target_url or get_google_sheets_url()).strip()
    if not url:
        print("[Google Sheets] Cap URL configurat. S'utilitza la base de dades local SQLite.")
        return {'ok': False, 'message': 'Cap URL de Google Sheets configurat.'}

    print(f"[Google Sheets] Iniciant hidratació des de Google Sheets...")
    try:
        req_url = url
        if 'action=' not in req_url:
            separator = '&' if '?' in req_url else '?'
            req_url = f"{req_url}{separator}action=get_all"

        req = urllib.request.Request(
            req_url,
            headers={'User-Agent': 'TallerCeramicaBackend/1.0', 'Accept': 'application/json'}
        )

        with execute_safe_request(req, timeout=25) as resp:
            raw = resp.read().decode('utf-8')
            res = json.loads(raw)

        if res.get('status') != 'success' or 'data' not in res:
            print(f"[Google Sheets] Resposta inesperada: {res}")
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

                # Detectar columnes desplaçades del full antic
                raw_tel = str(r.get('telefon') or '').strip()
                raw_data = str(r.get('data') or '').strip()

                if ('2026' in raw_tel or 'GMT' in raw_tel) and ('1899' in raw_data or ':' in raw_data):
                    clean_data = sanitize_date_str(raw_tel)
                    clean_inici = sanitize_time_str(raw_data, '10:00')
                    clean_fi = sanitize_time_str(r.get('hora_inici'), '11:30')
                    clean_franja = str(r.get('hora_fi') or 'F1').strip()
                    clean_estat = str(r.get('franja') or 'confirmada').strip()
                    clean_act = 'Torn'
                    clean_act_id = 'torn'
                    clean_places = 1
                    clean_tel = ''
                    clean_notes = str(r.get('activitat_id') or '').strip()
                else:
                    clean_data = sanitize_date_str(raw_data)
                    clean_inici = sanitize_time_str(r.get('hora_inici'), '10:00')
                    clean_fi = sanitize_time_str(r.get('hora_fi'), '11:30')
                    clean_franja = str(r.get('franja') or 'F1').strip()
                    clean_estat = str(r.get('estat') or 'confirmada').strip()
                    clean_act = str(r.get('activitat') or 'Torn').strip()
                    if clean_act in ('1.5', '2.0', '1', '2', ''):
                        clean_act = 'Torn'
                    clean_act_id = str(r.get('activitat_id') or 'torn').strip()
                    if clean_act_id in ('1.5', '2.0', ''):
                        clean_act_id = 'torn'
                    try:
                        clean_places = int(r.get('places', 1))
                        if clean_places < 1 or clean_places > 12:
                            clean_places = 1
                    except Exception:
                        clean_places = 1
                    clean_tel = str(r.get('telefon') or '').strip()
                    clean_notes = str(r.get('notes') or '').strip()

                clean_hores = float(r.get('hores', 1.5))
                cal_id = str(r.get('calendar_event_id') or '').strip() or None

                cursor.execute('''
                    INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, estat, hores, notes, created_at, calendar_event_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        created_at = excluded.created_at,
                        calendar_event_id = COALESCE(excluded.calendar_event_id, reserves.calendar_event_id)
                ''', (
                    r['id'], r['student_id'], r.get('student_nom', ''),
                    clean_data, clean_inici, clean_fi,
                    clean_franja, clean_act, clean_act_id, clean_places,
                    clean_tel, clean_estat, clean_hores, clean_notes,
                    r.get('created_at', datetime.now().isoformat()),
                    cal_id
                ))

            # 5. Bolcar configuració
            for k, v in config.items():
                if k:
                    if k == 'aforament_maxim_per_franja' and str(v) in ('8', '15', ''):
                        v = '12'
                    if k == 'taller_nom' and str(v) in ('Taller de Ceràmica', 'Taller de Ceramica', ''):
                        v = 'Roig de Coure'
                    cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))

            conn.commit()

        msg = f"Hidratació completada: {len(alumnes)} alumnes, {len(paquets)} paquets, {len(sessions)} sessions, {len(reserves)} reserves sincronitzades des de Google Sheets."
        print(f"[Google Sheets] {msg}")
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
        print(f"[Google Sheets] {err_msg}")
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
            with execute_safe_request(req, timeout=20) as resp:
                raw_resp = resp.read()
                try:
                    res_data = json.loads(raw_resp.decode('utf-8'))
                    if action == 'add_reserva' and res_data.get('status') == 'success':
                        created_cal_id = res_data.get('calendar_event_id')
                        if created_cal_id and payload.get('id'):
                            with get_db() as c_conn:
                                c_cur = c_conn.cursor()
                                c_cur.execute('UPDATE reserves SET calendar_event_id = ? WHERE id = ?', (created_cal_id, payload['id']))
                                c_conn.commit()
                except Exception:
                    pass
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

def format_hms_human(seconds):
    if seconds is None:
        return "0h 0m 0s"
    is_neg = seconds < 0
    sec = abs(int(round(seconds)))
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    prefix = "-" if is_neg else ""
    return f"{prefix}{h}h {m}m {s}s"

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
            'humanBought': format_hms_human(total_bought),
            'humanSpent': format_hms_human(total_spent),
            'humanBalance': format_hms_human(balance_sec),
            'isNegative': balance_sec < 0,
            'isLow': 0 <= balance_sec < 7200
        }

DEFAULT_ACTIVITATS = [
    {"id": "torn", "nom": "Torn", "descripcio": "Sessió al torn de terrissaire", "capacitatMax": 4, "icon": "", "color": "#831D1D"},
    {"id": "modelatge", "nom": "Modelatge", "descripcio": "Modelat de fang a mà i escultura", "capacitatMax": 8, "icon": "", "color": "#5E7E6F"},
    {"id": "pintar", "nom": "Pintar ceràmica", "descripcio": "Pintura i esmaltat sobre ceràmica", "capacitatMax": 12, "icon": "", "color": "#831D1D"}
]

def get_activitats_config():
    """Retorna les 3 activitats oficials amb capacitats dinàmiques des de la base de dades"""
    cap_torn = 4
    cap_modelatge = 8
    cap_pintar = 12
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT clau, valor FROM configuracio WHERE clau IN ("capacitat_max_torn", "capacitat_max_modelatge", "capacitat_max_pintar")')
            rows = cursor.fetchall()
            for r in rows:
                val = int(r['valor'])
                if r['clau'] == 'capacitat_max_torn' and val > 0:
                    cap_torn = val
                elif r['clau'] == 'capacitat_max_modelatge' and val > 0:
                    cap_modelatge = val
                elif r['clau'] == 'capacitat_max_pintar' and val > 0:
                    cap_pintar = val
    except Exception:
        pass

    return [
        {"id": "torn", "nom": "Torn", "descripcio": "Sessió al torn de terrissaire", "capacitatMax": cap_torn, "icon": "", "color": "#3B82F6"},
        {"id": "modelatge", "nom": "Modelatge", "descripcio": "Modelat de fang a mà i escultura", "capacitatMax": cap_modelatge, "icon": "", "color": "#10B981"},
        {"id": "pintar", "nom": "Pintar ceràmica", "descripcio": "Pintura i esmaltat sobre ceràmica", "capacitatMax": cap_pintar, "icon": "", "color": "#F59E0B"}
    ]

# Propietat retrocompatible
ACTIVITATS = DEFAULT_ACTIVITATS

def send_whatsapp_meta(to_phone, template_name, parameters=None, language_code='ca'):
    """
    Envia un missatge mitjançant l'API oficial Meta WhatsApp Cloud API (directament, sense intermediaris).
    Documentació oficial: https://developers.facebook.com/docs/whatsapp/cloud-api
    """
    phone_clean = re.sub(r'[^0-9]', '', str(to_phone or ''))
    if not phone_clean:
        return {'ok': False, 'error': 'Telèfon buit o no vàlid'}

    # Assegurar prefix internacional (Espanya 34 per defecte si en té 9)
    if len(phone_clean) == 9 and phone_clean.startswith(('6', '7', '8', '9')):
        phone_clean = '34' + phone_clean

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT clau, valor FROM configuracio WHERE clau IN ("whatsapp_enabled", "whatsapp_meta_phone_id", "whatsapp_meta_token")')
        cfg = {r['clau']: r['valor'] for r in cursor.fetchall()}

    if cfg.get('whatsapp_enabled') != '1':
        return {'ok': False, 'error': 'WhatsApp Meta API no està activat a la configuració'}

    phone_id = (cfg.get('whatsapp_meta_phone_id') or '').strip()
    token = (cfg.get('whatsapp_meta_token') or '').strip()

    if not phone_id or not token:
        return {'ok': False, 'error': 'Cal configurar el Phone Number ID i el Token de Meta a l\'Administració'}

    url = f"https://graph.facebook.com/v20.0/{phone_id}/messages"

    components = []
    if parameters and len(parameters) > 0:
        param_objs = [{'type': 'text', 'text': str(p)} for p in parameters]
        components.append({'type': 'body', 'parameters': param_objs})

    payload = {
        'messaging_product': 'whatsapp',
        'recipient_type': 'individual',
        'to': phone_clean,
        'type': 'template',
        'template': {
            'name': template_name,
            'language': {'code': language_code},
            'components': components
        }
    }

    try:
        data_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data_bytes,
            headers={
                'Authorization': f"Bearer {token}",
                'Content-Type': 'application/json',
                'User-Agent': 'TallerCeramicaBackend/1.0'
            }
        )
        with execute_safe_request(req, timeout=15) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            msg_id = ''
            if 'messages' in res_json and len(res_json['messages']) > 0 and 'id' in res_json['messages'][0]:
                msg_id = res_json['messages'][0]['id']
            return {'ok': True, 'message_id': msg_id, 'meta_response': res_json, 'destinatari': phone_clean}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        print(f"[WhatsApp Meta API] HTTP Error {e.code}: {err_body}")
        return {'ok': False, 'error': f"HTTP {e.code}: {err_body}"}
    except Exception as e:
        print(f"[WhatsApp Meta API] Error: {e}")
        return {'ok': False, 'error': str(e)}

def send_whatsapp_meta_async(to_phone, template_name, parameters=None, language_code='ca', on_success_cb=None):
    def _worker():
        res = send_whatsapp_meta(to_phone, template_name, parameters, language_code)
        if res.get('ok') and callable(on_success_cb):
            try:
                on_success_cb(res)
            except Exception as ex:
                print(f"[WhatsApp Callback Error]: {ex}")
    t = threading.Thread(target=_worker, daemon=True)
    t.start()

def start_whatsapp_scheduler():
    """Fil en segon pla per enviar avisos de WhatsApp (recordatori 48h i recordatori dia 8:00h)"""
    def _scheduler_loop():
        while True:
            try:
                now = datetime.now()
                today_str = now.strftime('%Y-%m-%d')

                # 1. Avisos del mateix dia a les 8:00 AM (comprova durant la franja de les 08:00)
                if now.hour == 8:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute('SELECT valor FROM configuracio WHERE clau = "whatsapp_meta_template_recordatori_dia"')
                        r_tpl = cursor.fetchone()
                        tpl_dia = r_tpl['valor'].strip() if (r_tpl and r_tpl['valor']) else 'reserva_recordatori_dia'

                        cursor.execute("""
                            SELECT * FROM reserves 
                            WHERE data = ? AND estat = 'confirmada' 
                              AND (whatsapp_notif_dia IS NULL OR whatsapp_notif_dia = 0)
                              AND telefon != ''
                        """, (today_str,))
                        res_today = [row_to_dict(x) for x in cursor.fetchall()]

                    for r in res_today:
                        nom = r.get('student_nom') or 'Client'
                        hora = r.get('hora_inici') or '10:00'
                        act = r.get('activitat') or 'Torn'
                        def _mark_done(res, res_id=r['id']):
                            with get_db() as c_conn:
                                c_conn.cursor().execute("UPDATE reserves SET whatsapp_notif_dia = 1 WHERE id = ?", (res_id,))
                                c_conn.commit()
                        send_whatsapp_meta_async(r['telefon'], tpl_dia, [nom, hora, act], on_success_cb=_mark_done)

                # 2. Recordatoris a 48 hores vista (data = avui + 2 dies)
                date_48h = (now + timedelta(days=2)).strftime('%Y-%m-%d')
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT valor FROM configuracio WHERE clau = "whatsapp_meta_template_recordatori_48h"')
                    r_tpl48 = cursor.fetchone()
                    tpl_48 = r_tpl48['valor'].strip() if (r_tpl48 and r_tpl48['valor']) else 'reserva_recordatori_48h'

                    cursor.execute("""
                        SELECT * FROM reserves 
                        WHERE data = ? AND estat = 'confirmada' 
                          AND (whatsapp_notif_48h IS NULL OR whatsapp_notif_48h = 0)
                          AND telefon != ''
                    """, (date_48h,))
                    res_48 = [row_to_dict(x) for x in cursor.fetchall()]

                for r in res_48:
                    nom = r.get('student_nom') or 'Client'
                    data_res = r.get('data')
                    hora = r.get('hora_inici') or '10:00'
                    act = r.get('activitat') or 'Torn'
                    def _mark_done_48(res, res_id=r['id']):
                        with get_db() as c_conn:
                            c_conn.cursor().execute("UPDATE reserves SET whatsapp_notif_48h = 1 WHERE id = ?", (res_id,))
                            c_conn.commit()
                    send_whatsapp_meta_async(r['telefon'], tpl_48, [nom, data_res, hora, act], on_success_cb=_mark_done_48)

            except Exception as e:
                print(f"[WhatsApp Scheduler] Avís: {e}")

            # Comprovar cada 15 minuts
            time.sleep(900)

    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()

# Iniciar scheduler
try:
    start_whatsapp_scheduler()
except Exception as e:
    print(f"[WhatsApp Scheduler Error]: {e}")

INTERVALS_INICI_2H = ["10:00", "10:15", "10:30", "10:45", "11:00"]

def calcular_hora_fi_2h(hora_inici_str):
    try:
        parts = [int(p) for p in hora_inici_str.split(':')]
        total_min = parts[0] * 60 + parts[1] + 120
        h = total_min // 60
        m = total_min % 60
        return f"{h:02d}:{m:02d}"
    except Exception:
        return "12:00"

DEFAULT_FRANGES = [
    {"id": "M1", "nom": "Matí (10:00 - 13:00)", "inici": "10:00", "fi": "13:00", "hores": 2.0}
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

def calculate_recurring_dates(start_date_str, frequency='setmanal', repetitions=4, skip_closed=True, max_search_steps=52):
    """
    Genera una llista de dates ISO (YYYY-MM-DD) segons la freqüència i nombre de sessions.
    Si skip_closed és True, avança en cicles de freqüència saltant els dies tancats fins a
    aconseguir el total de sessions vàlides requerides.
    """
    try:
        cur_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
    except Exception:
        cur_date = get_now().date()

    valid_dates = []
    skipped_dates = []
    step = 0

    while len(valid_dates) < repetitions and step < max_search_steps:
        step += 1
        d_str = cur_date.strftime('%Y-%m-%d')
        closed_info = is_dia_tancat(d_str)

        if closed_info['tancat']:
            skipped_dates.append({'data': d_str, 'motiu': closed_info['motiu']})
            if not skip_closed:
                pass
        else:
            valid_dates.append(d_str)

        if frequency == 'quinzenal':
            cur_date += timedelta(days=14)
        elif frequency == 'mensual':
            year = cur_date.year + (cur_date.month // 12)
            month = (cur_date.month % 12) + 1
            day = min(cur_date.day, 28)
            cur_date = date(year, month, day)
        else:
            cur_date += timedelta(days=7)

    return valid_dates, skipped_dates

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
    activitats_list = get_activitats_config()
    estat_dia = is_dia_tancat(data_str)

    if estat_dia['tancat']:
        return {
            'data': data_str,
            'tancat': True,
            'motiu': estat_dia['motiu'],
            'aforamentMaxim': max_cap,
            'totalPlacesDia': 0,
            'totalOcupadesDia': 0,
            'placesLliuresDia': 0,
            'franges': [],
            'intervals': [],
            'activitats': activitats_list
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

    # Totes les reserves del matí comparteixen l'aforament del taller (màx 12)
    total_ocupades_dia = sum(int(r.get('places') or 1) for r in active_reserves)
    lliures_dia = max(0, max_cap - total_ocupades_dia)
    esta_complet = (lliures_dia == 0)

    # Ocupació per activitat respectant el límit absolut de la franja (màxim 12)
    ocupacio_per_act = {}
    activitats_franja = []
    for act in activitats_list:
        act_id = act['id']
        act_nom = act['nom'].lower()
        ocupat_act = sum(int(r.get('places') or 1) for r in active_reserves if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act_nom)
        ocupacio_per_act[act_id] = ocupat_act
        capacitat_max_act = act['capacitatMax']
        lliures_act = max(0, capacitat_max_act - ocupat_act)
        # El límit efectiu és el mínim entre les places lliures globals del dia i les de l'activitat
        places_efectives = min(lliures_dia, lliures_act)
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

    if lliures_dia == 0:
        estat_franja = 'complet'
    elif lliures_dia <= 3 and total_ocupades_dia > 0:
        estat_franja = 'ultimes_places'
    else:
        estat_franja = 'lliure'

    # 5 intervals d'arribada cada 15 minuts de 10:00 a 11:00 (tots de 2h)
    intervals_list = []
    for h_ini in INTERVALS_INICI_2H:
        h_fi = calcular_hora_fi_2h(h_ini)
        intervals_list.append({
            'id': h_ini,
            'inici': h_ini,
            'fi': h_fi,
            'hores': 2.0,
            'nom': f"{h_ini} - {h_fi} (2h)",
            'placesLliures': lliures_dia,
            'estaComplet': esta_complet
        })

    result_franges = []
    for f in franges:
        f_id = f['id']
        result_franges.append({
            'id': f_id,
            'nom': f.get('nom'),
            'inici': f.get('inici'),
            'fi': f.get('fi'),
            'hores': float(f.get('hores', 2.0)),
            'totalPlaces': max_cap,
            'placesOcupades': total_ocupades_dia,
            'placesLliures': lliures_dia,
            'estat': estat_franja,
            'estaComplet': esta_complet,
            'ocupacioPerActivitat': ocupacio_per_act,
            'activitats': activitats_franja,
            'reserves': active_reserves,
            'intervals': intervals_list
        })

    return {
        'data': data_str,
        'tancat': False,
        'motiu': '',
        'aforamentMaxim': max_cap,
        'totalPlacesDia': max_cap * len(franges),
        'totalOcupadesDia': total_ocupades_dia,
        'placesLliuresDia': lliures_dia,
        'franges': result_franges,
        'intervals': intervals_list,
        'activitats': activitats_franja
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

    activitats_list = get_activitats_config()
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
        for act in activitats_list:
            act_id = act['id']
            act_nom = act['nom'].lower()
            if total_lliures_dia > 0:
                ocupat_act = sum(int(r.get('places') or 1) for r in day_res if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act_nom)
                if ocupat_act < act['capacitatMax']:
                    acts_amb_places.append(act_id)

        if total_lliures_dia == 0:
            estat = 'complet'
        elif total_lliures_dia <= 3:
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
        'activitats': activitats_list
    }

def find_student_by_code(cursor, code, actiu_only=False):
    if not code:
        return None
    clean_code = str(code).strip()
    if not clean_code:
        return None
    no_spaces = re.sub(r'[\s\-_]', '', clean_code)
    clean_digits = re.sub(r'[^0-9]', '', clean_code)
    no_tc = re.sub(r'^TC[-_\s]*', '', clean_code, flags=re.IGNORECASE).strip()
    no_tc_clean = re.sub(r'[\s\-_]', '', no_tc)
    phone_suffix = clean_digits[-9:] if len(clean_digits) >= 9 else (clean_digits if len(clean_digits) >= 6 else None)
    
    actiu_clause = "actiu = 1 AND " if actiu_only else ""
    query = f'''
        SELECT * FROM alumnes 
        WHERE {actiu_clause}(
            UPPER(TRIM(id)) = UPPER(TRIM(:clean_code))
            OR UPPER(TRIM(id)) = UPPER(TRIM(:no_tc))
            OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(id)), '-', ''), ' ', ''), '_', '') = UPPER(:no_spaces)
            OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(id)), '-', ''), ' ', ''), '_', '') = UPPER(:no_tc_clean)
            OR (LENGTH(:clean_code) >= 2 AND UPPER(TRIM(id)) = 'TC-' || UPPER(:clean_code))
            OR (LENGTH(:no_tc) >= 2 AND UPPER(TRIM(id)) = 'TC-' || UPPER(:no_tc))
            OR (LENGTH(:clean_code) >= 2 AND UPPER(TRIM(id)) = 'TC' || UPPER(:clean_code))
            OR (LENGTH(:clean_code) >= 3 AND UPPER(TRIM(id)) LIKE :clean_code || '%')
            OR (LENGTH(:no_tc) >= 3 AND UPPER(TRIM(id)) LIKE :no_tc || '%')
            OR (LENGTH(:clean_code) >= 2 AND REPLACE(UPPER(TRIM(id)), 'TC-', '') = UPPER(:clean_code))
            OR (LENGTH(:no_tc) >= 2 AND REPLACE(UPPER(TRIM(id)), 'TC-', '') = UPPER(:no_tc))
            OR (LENGTH(:clean_code) >= 3 AND REPLACE(UPPER(TRIM(id)), 'TC-', '') LIKE :clean_code || '%')
            OR (LENGTH(:no_tc) >= 3 AND REPLACE(UPPER(TRIM(id)), 'TC-', '') LIKE :no_tc || '%')
            OR TRIM(pin) = TRIM(:clean_code)
            OR TRIM(telefon) = TRIM(:clean_code)
            OR (:phone_suffix IS NOT NULL AND REPLACE(REPLACE(REPLACE(REPLACE(telefon, '+', ''), ' ', ''), '-', ''), '.', '') LIKE '%' || :phone_suffix)
            OR UPPER(TRIM(nom || ' ' || COALESCE(cognoms, ''))) = UPPER(TRIM(:clean_code))
            OR (LENGTH(:clean_code) >= 4 AND UPPER(TRIM(nom || ' ' || COALESCE(cognoms, ''))) LIKE UPPER(TRIM(:clean_code)) || '%')
            OR UPPER(TRIM(nom)) = UPPER(TRIM(:clean_code))
            OR UPPER(TRIM(cognoms)) = UPPER(TRIM(:clean_code))
            OR (LENGTH(:clean_code) >= 4 AND UPPER(TRIM(cognoms)) LIKE UPPER(TRIM(:clean_code)) || '%')
            OR (LENGTH(:clean_code) >= 3 AND LOWER(TRIM(email)) = LOWER(TRIM(:clean_code)))
        )
        ORDER BY 
            CASE 
                WHEN UPPER(TRIM(id)) = UPPER(TRIM(:clean_code)) THEN 1
                WHEN UPPER(TRIM(id)) = UPPER(TRIM(:no_tc)) THEN 2
                WHEN UPPER(TRIM(id)) = UPPER(:no_spaces) THEN 3
                WHEN UPPER(TRIM(id)) = 'TC-' || UPPER(:clean_code) THEN 4
                WHEN UPPER(TRIM(id)) = 'TC-' || UPPER(:no_tc) THEN 5
                WHEN REPLACE(UPPER(TRIM(id)), 'TC-', '') = UPPER(:clean_code) THEN 6
                WHEN REPLACE(UPPER(TRIM(id)), 'TC-', '') = UPPER(:no_tc) THEN 7
                WHEN UPPER(TRIM(id)) LIKE :clean_code || '%' THEN 8
                WHEN UPPER(TRIM(id)) LIKE :no_tc || '%' THEN 9
                WHEN UPPER(TRIM(nom || ' ' || COALESCE(cognoms, ''))) = UPPER(TRIM(:clean_code)) THEN 10
                WHEN UPPER(TRIM(nom)) = UPPER(TRIM(:clean_code)) THEN 11
                WHEN UPPER(TRIM(cognoms)) = UPPER(TRIM(:clean_code)) THEN 12
                ELSE 13
            END
        LIMIT 1
    '''
    params = {
        'clean_code': clean_code,
        'no_spaces': no_spaces,
        'clean_digits': clean_digits,
        'no_tc': no_tc,
        'no_tc_clean': no_tc_clean,
        'phone_suffix': phone_suffix
    }
    cursor.execute(query, params)
    return row_to_dict(cursor.fetchone())

def authenticate_student(cursor, identifier, pin):
    student = find_student_by_code(cursor, identifier, actiu_only=False)
    if not student:
        return None, "No s'ha trobat cap alumne amb aquest nom o identificador"
    
    stored_pin = str(student['pin'] or '').strip()
    input_pin = str(pin or '').strip()
    
    # Si l'alumne encara no té cap PIN definit, s'inicialitza amb el que introdueix
    if not stored_pin and input_pin:
        cursor.execute("UPDATE alumnes SET pin = ? WHERE id = ?", (input_pin, student['id']))
        student['pin'] = input_pin
        stored_pin = input_pin
        
    if stored_pin != input_pin:
        return None, "Contrasenya (PIN) incorrecta. Revisa el teu PIN o fes servir les opcions de recuperació."
        
    return student, None

def recover_student_pin(cursor, identifier, contact):
    student = find_student_by_code(cursor, identifier, actiu_only=False)
    if not student:
        return None, "No s'ha trobat cap alumne amb aquest nom o identificador"
        
    clean_contact = re.sub(r'[\s\-_]', '', str(contact or '').strip().lower())
    clean_digits = re.sub(r'[^0-9]', '', clean_contact)
    
    stored_tel = re.sub(r'[^0-9]', '', str(student['telefon'] or ''))
    stored_email = str(student['email'] or '').strip().lower()
    
    matched = False
    if clean_digits and stored_tel:
        if stored_tel.endswith(clean_digits[-9:]) or clean_digits.endswith(stored_tel[-9:]):
            matched = True
    if clean_contact and stored_email and clean_contact == stored_email:
        matched = True
        
    if not matched:
        return None, "El telèfon o correu electrònic no coincideix amb el registrat a la fitxa de l'alumne."
        
    pin = student['pin'] or '1234'
    return {'id': student['id'], 'nom': student['nom'], 'pin': pin}, None

def generate_pkpass(student, balance=None):
    """
    Genera un arxiu binari Apple Wallet (.pkpass) oficial per a l'alumne.
    Permet afegir el carnet a Apple Wallet (iPhone i Apple Watch).
    """
    student_id = student['id']
    full_name = (student['nom'] + ' ' + (student.get('cognoms') or '')).strip()

    hours_human = ""
    if balance and isinstance(balance, dict):
        hours_human = f"{balance.get('hores', 0)}h {balance.get('minuts', 0)}m"

    pass_data = {
        "formatVersion": 1,
        "passTypeIdentifier": "pass.cat.roigdecoure.carnet",
        "serialNumber": f"TC-{student_id}",
        "teamIdentifier": "ROIGDECOURE",
        "organizationName": "Roig de Coure",
        "description": f"Carnet de Taller - {full_name}",
        "logoText": "Roig de Coure",
        "foregroundColor": "rgb(255, 255, 255)",
        "backgroundColor": "rgb(131, 29, 29)",
        "labelColor": "rgb(240, 225, 220)",
        "generic": {
            "primaryFields": [
                {
                    "key": "nom",
                    "label": "ALUMNE/A",
                    "value": full_name
                }
            ],
            "secondaryFields": [
                {
                    "key": "saldo",
                    "label": "SALDO DISPONIBLE",
                    "value": hours_human or "Actiu"
                },
                {
                    "key": "taller",
                    "label": "TALLER",
                    "value": "Roig de Coure"
                }
            ],
            "auxiliaryFields": [
                {
                    "key": "codi",
                    "label": "CODI ACCÉS",
                    "value": student_id
                }
            ],
            "backFields": [
                {
                    "key": "info",
                    "label": "Instruccions d'ús",
                    "value": "Apropa aquest codi a l'escàner del taller per registrar automàticament entrada o sortida. Si portes Apple Watch, activa el passi al canell prement dues vegades el botó lateral."
                },
                {
                    "key": "alumne_id",
                    "label": "Identificador Alumne",
                    "value": student_id
                },
                {
                    "key": "telefon",
                    "label": "Telèfon Alumne",
                    "value": student.get('telefon') or "No especificat"
                },
                {
                    "key": "espai",
                    "label": "Espai",
                    "value": "Roig de Coure - Ceràmica"
                }
            ]
        },
        "barcodes": [
            {
                "message": student_id,
                "format": "PKBarcodeFormatQR",
                "messageEncoding": "iso-8859-1",
                "altText": student_id
            }
        ],
        "barcode": {
            "message": student_id,
            "format": "PKBarcodeFormatQR",
            "messageEncoding": "iso-8859-1",
            "altText": student_id
        }
    }

    pass_bytes = json.dumps(pass_data, indent=2, ensure_ascii=False).encode('utf-8')
    manifest = {
        "pass.json": hashlib.sha1(pass_bytes).hexdigest()
    }

    img_files = {}
    icon_path = os.path.join(BASE_DIR, 'icons', 'icon-192.png')
    if os.path.isfile(icon_path):
        with open(icon_path, 'rb') as f:
            c = f.read()
            img_files['icon.png'] = c
            img_files['icon@2x.png'] = c

    logo_path = os.path.join(BASE_DIR, 'img', 'logo.png')
    if not os.path.isfile(logo_path):
        logo_path = os.path.join(BASE_DIR, 'icons', 'logo.png')
    if os.path.isfile(logo_path):
        with open(logo_path, 'rb') as f:
            c = f.read()
            img_files['logo.png'] = c
            img_files['logo@2x.png'] = c

    for name, content in img_files.items():
        manifest[name] = hashlib.sha1(content).hexdigest()

    manifest_bytes = json.dumps(manifest, indent=2).encode('utf-8')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('pass.json', pass_bytes)
        zf.writestr('manifest.json', manifest_bytes)
        zf.writestr('signature', b'')
        for name, content in img_files.items():
            zf.writestr(name, content)

    return buf.getvalue()

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
            # Aliases per a rutes netes i compatibilitat (singular/plural, sense .html)
            clean_path = path.rstrip('/')
            query_str = ('?' + url.query) if url.query else ''
            if clean_path in ('/alumne', '/alumnes', '/alumnes.html'):
                self.path = '/alumne.html' + query_str
            elif clean_path == '/admin':
                self.path = '/admin.html' + query_str
            elif clean_path in ('/reserva', '/reserves'):
                self.path = '/reserva.html' + query_str
            elif clean_path == '/carnet':
                self.path = '/carnet.html' + query_str
            elif clean_path == '/scanner':
                self.path = '/scanner.html' + query_str
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

            elif path == '/api/admin/backups':
                create_daily_snapshot_if_needed()
                backups_list = []
                # 1. Base de dades actual
                if os.path.exists(DB_PATH):
                    live_size = os.path.getsize(DB_PATH)
                    live_mtime = datetime.fromtimestamp(os.path.getmtime(DB_PATH))
                    backups_list.append({
                        'filename': 'ceramica.db',
                        'tipus': 'actual',
                        'data': live_mtime.strftime('%Y-%m-%d %H:%M:%S'),
                        'midaBytes': live_size,
                        'midaFormatted': f"{live_size / 1024:.1f} KB" if live_size < 1048576 else f"{live_size / 1048576:.1f} MB",
                        'isRestoreable': False
                    })
                
                # 2. Còpies històriques
                if os.path.exists(BACKUP_DIR):
                    for fname in sorted(os.listdir(BACKUP_DIR), reverse=True):
                        if fname.endswith('.db'):
                            fpath = os.path.join(BACKUP_DIR, fname)
                            if os.path.isfile(fpath):
                                sz = os.path.getsize(fpath)
                                mtime = datetime.fromtimestamp(os.path.getmtime(fpath))
                                b_type = 'diari' if 'ceramica_20' in fname else ('pre_restauracio' if 'pre_restore' in fname else 'manual')
                                backups_list.append({
                                    'filename': fname,
                                    'tipus': b_type,
                                    'data': mtime.strftime('%Y-%m-%d %H:%M:%S'),
                                    'midaBytes': sz,
                                    'midaFormatted': f"{sz / 1024:.1f} KB" if sz < 1048576 else f"{sz / 1048576:.1f} MB",
                                    'isRestoreable': True
                                })
                self.send_json({'ok': True, 'backups': backups_list})
                return

            elif path == '/api/admin/backups/download':
                fname = params.get('file', ['ceramica.db'])[0].strip()
                # Seguretat: evitar path traversal
                safe_name = os.path.basename(fname)
                if safe_name == 'ceramica.db':
                    target_path = DB_PATH
                else:
                    target_path = os.path.join(BACKUP_DIR, safe_name)
                
                if not os.path.exists(target_path) or not os.path.isfile(target_path):
                    self.send_json({'ok': False, 'error': 'Arxiu de còpia no trobat'}, 404)
                    return
                
                with open(target_path, 'rb') as f:
                    content = f.read()
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-sqlite3')
                self.send_header('Content-Disposition', f'attachment; filename="{safe_name}"')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
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

            elif path == '/api/alumnes/verificar':
                # Verificació privada d'alumne per a la reserva pública (sense exposar la llista d'alumnes)
                query_str = urllib.parse.parse_qs(url.query).get('q', [''])[0].strip()
                if not query_str:
                    self.send_json({'ok': True, 'found': False, 'message': 'Cal indicar un nom o codi'})
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, query_str, actiu_only=True)
                    if student:
                        self.send_json({
                            'ok': True,
                            'found': True,
                            'alumne': {
                                'id': student['id'],
                                'nom': student['nom'],
                                'cognoms': student['cognoms'] or '',
                                'telefon': student['telefon'] or '',
                                'email': student['email'] or ''
                            }
                        })
                    else:
                        self.send_json({'ok': True, 'found': False, 'message': 'No s\'ha trobat cap alumne actiu amb aquest nom o número'})
                return

            elif path == '/api/wallet/pass':
                student_code = urllib.parse.parse_qs(url.query).get('id', [''])[0].strip()
                if not student_code:
                    self.send_json({'ok': False, 'error': 'Cal indicar un codi o id d\'alumne (?id=...)'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, student_code, actiu_only=False)
                    if not student:
                        self.send_json({'ok': False, 'error': 'Alumne no trobat'}, 404)
                        return
                    balance = get_student_balance(student['id'])

                try:
                    pkpass_data = generate_pkpass(student, balance)
                    filename = f"RoigDeCoure_{student['id']}.pkpass"
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.apple.pkpass')
                    self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                    self.send_header('Content-Length', str(len(pkpass_data)))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                    self.end_headers()
                    self.wfile.write(pkpass_data)
                    return
                except Exception as e:
                    self.send_json({'ok': False, 'error': f'Error generant el passi de wallet: {str(e)}'}, 500)
                    return

            elif path.startswith('/api/alumnes/'):
                student_code = urllib.parse.unquote(path.replace('/api/alumnes/', '').strip())
                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, student_code, actiu_only=False)
                    if not student:
                        self.send_json({'ok': False, 'error': 'Alumne no trobat'}, 404)
                        return

                    real_id = student['id']
                    cursor.execute('SELECT * FROM paquets_hores WHERE student_id = ? ORDER BY data DESC', (real_id,))
                    packs = [row_to_dict(r) for r in cursor.fetchall()]

                    cursor.execute('SELECT * FROM sessions WHERE student_id = ? ORDER BY entrada DESC', (real_id,))
                    sessions = [row_to_dict(r) for r in cursor.fetchall()]

                    cursor.execute('SELECT * FROM reserves WHERE student_id = ? ORDER BY data DESC, hora_inici DESC', (real_id,))
                    reserves = [row_to_dict(r) for r in cursor.fetchall()]

                    cursor.execute('SELECT * FROM sessions WHERE student_id = ? AND estat = "oberta" ORDER BY entrada DESC LIMIT 1', (real_id,))
                    active_session = row_to_dict(cursor.fetchone())

                    balance = get_student_balance(real_id)

                self.send_json({
                    'ok': True,
                    'alumne': student,
                    'paquets': packs,
                    'sessions': sessions,
                    'reserves': reserves,
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
                data_str = params.get('data', [get_now().strftime('%Y-%m-%d')])[0]
                disp = get_disponibilitat(data_str)
                self.send_json({'ok': True, **disp})
                return

            elif path == '/api/reserves/mes':
                now = get_now()
                try:
                    any_val = int(params.get('any', [now.year])[0])
                    mes_val = int(params.get('mes', [now.month])[0])
                except Exception:
                    any_val, mes_val = now.year, now.month
                disp_mes = get_disponibilitat_mes(any_val, mes_val)
                self.send_json({'ok': True, **disp_mes})
                return

            elif path == '/api/reserves/activitats':
                self.send_json({'ok': True, 'activitats': get_activitats_config()})
                return

            elif path == '/api/config':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT clau, valor FROM configuracio')
                    rows = cursor.fetchall()
                    cfg = {r['clau']: r['valor'] for r in rows if r['clau'] != 'admin_pin'}
                self.send_json({'ok': True, 'config': cfg})
                return

            elif path == '/api/carnet/config':
                cfg = get_carnet_config()
                self.send_json({'ok': True, 'success': True, 'config': cfg})
                return

            elif path == '/api/carnet/export-svg':
                query_params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                student_id = (query_params.get('id', [''])[0]).strip()
                student = None
                if student_id:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT * FROM alumnes WHERE id = ?", (student_id,))
                        row = cursor.fetchone()
                        if row:
                            student = row_to_dict(row)
                if not student:
                    student = {'id': student_id or '300Z', 'nom': 'Zoey', 'cognoms': ''}
                svg_data = generate_carnet_svg(student)
                self.send_response(200)
                self.send_header('Content-Type', 'image/svg+xml; charset=utf-8')
                self.send_header('Content-Disposition', f'attachment; filename="carnet-{student.get("id", "alumne")}.svg"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(svg_data.encode('utf-8'))
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
                    config = {r['clau']: r['valor'] for r in cursor.fetchall() if r['clau'] != 'admin_pin'}
                self.send_json({
                    'versio': '1.0',
                    'timestamp': get_now().strftime('%Y-%m-%dT%H:%M:%S'),
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
            if path == '/api/admin/auth':
                pin = str(data.get('pin', '')).strip()
                if verify_admin_pin(pin):
                    self.send_json({'ok': True, 'token': 'roig_admin_ok', 'message': 'Autenticació correcta'})
                else:
                    self.send_json({'ok': False, 'error': 'PIN incorrecte'}, 401)
                return

            elif path == '/api/admin/change-pin':
                old_pin = str(data.get('oldPin', '')).strip()
                new_pin = str(data.get('newPin', '')).strip()
                if not verify_admin_pin(old_pin):
                    self.send_json({'ok': False, 'error': 'El PIN actual no és correcte'}, 401)
                    return
                if len(new_pin) < 4:
                    self.send_json({'ok': False, 'error': 'El nou PIN ha de tenir com a mínim 4 caràcters'}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('admin_pin', ?)", (new_pin,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'PIN d\'administrador actualitzat correctament'})
                return

            elif path == '/api/admin/backups':
                try:
                    filename = create_manual_snapshot()
                    self.send_json({'ok': True, 'filename': filename, 'message': f'Còpia de seguretat creada: {filename}'})
                except Exception as e:
                    self.send_json({'ok': False, 'error': f'Error creant còpia: {str(e)}'}, 500)
                return

            elif path == '/api/admin/backups/restore':
                fname = data.get('filename', '').strip()
                if not fname:
                    self.send_json({'ok': False, 'error': 'Cal especificar el nom de la còpia a restaurar'}, 400)
                    return
                safe_name = os.path.basename(fname)
                backup_file = os.path.join(BACKUP_DIR, safe_name)
                if not os.path.exists(backup_file) or not safe_name.endswith('.db'):
                    self.send_json({'ok': False, 'error': 'Arxiu de còpia no trobat o invàlid'}, 404)
                    return
                try:
                    # Crear backup de protecció de l'estat actual abans de restaurar
                    create_manual_snapshot(prefix="ceramica_pre_restore")
                    with sqlite3.connect(backup_file) as src_conn:
                        with get_db() as dest_conn:
                            src_conn.backup(dest_conn)
                    self.send_json({'ok': True, 'message': f'Base de dades restaurada amb èxit des de {safe_name}'})
                except Exception as e:
                    self.send_json({'ok': False, 'error': f'Error restaurant còpia: {str(e)}'}, 500)
            elif path == '/api/alumnes/auth':
                identifier = str(data.get('identifier', '')).strip()
                pin = str(data.get('pin', '')).strip()
                if not identifier or not pin:
                    self.send_json({'ok': False, 'error': "Cal introduir el nom o codi d'alumne i la contrasenya"}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    student, err = authenticate_student(cursor, identifier, pin)
                    if err:
                        status_code = 404 if "No s'ha trobat" in err else 401
                        self.send_json({'ok': False, 'error': err}, status_code)
                        return
                    conn.commit()
                    real_id = student['id']
                    cursor.execute('SELECT * FROM paquets_hores WHERE student_id = ? ORDER BY data DESC', (real_id,))
                    packs = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM sessions WHERE student_id = ? ORDER BY entrada DESC', (real_id,))
                    sessions = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM sessions WHERE student_id = ? AND estat = "oberta" ORDER BY entrada DESC LIMIT 1', (real_id,))
                    active_session = row_to_dict(cursor.fetchone())
                    balance = get_student_balance(real_id)
                self.send_json({
                    'ok': True,
                    'alumne': student,
                    'paquets': packs,
                    'sessions': sessions,
                    'sessioActiva': active_session,
                    'balanc': balance
                })
                return

            elif path == '/api/alumnes/recuperar-pin':
                identifier = str(data.get('identifier', '')).strip()
                contact = str(data.get('contact', '')).strip()
                if not identifier or not contact:
                    self.send_json({'ok': False, 'error': "Cal indicar el nom o codi d'alumne i el telèfon o correu de contacte"}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    res, err = recover_student_pin(cursor, identifier, contact)
                    if err:
                        self.send_json({'ok': False, 'error': err}, 400)
                        return
                self.send_json({
                    'ok': True,
                    'nom': res['nom'],
                    'id': res['id'],
                    'pin': res['pin'],
                    'message': f"Identitat verificada correctament per a {res['nom']}."
                })
                return

            elif path == '/api/alumnes/canviar-pin':
                student_id = str(data.get('student_id', '')).strip()
                new_pin = str(data.get('new_pin', '')).strip()
                current_pin = str(data.get('current_pin', '')).strip() if data.get('current_pin') else None
                if not student_id or not new_pin:
                    self.send_json({'ok': False, 'error': "Dades incompletes"}, 400)
                    return
                if len(new_pin) < 4:
                    self.send_json({'ok': False, 'error': "La nova contrasenya ha de tenir com a mínim 4 caràcters"}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, student_id)
                    if not student:
                        self.send_json({'ok': False, 'error': "Alumne no trobat"}, 404)
                        return
                    if current_pin is not None and student['pin'] and str(student['pin']).strip() != current_pin:
                        self.send_json({'ok': False, 'error': "La contrasenya actual no és correcta"}, 401)
                        return
                    cursor.execute("UPDATE alumnes SET pin = ? WHERE id = ?", (new_pin, student['id']))
                    conn.commit()
                self.send_json({'ok': True, 'message': "Contrasenya actualitzada correctament"})
                return

            elif path == '/api/alumnes':
                # Crear o actualitzar alumne
                student_id = (data.get('id') or '').strip()
                nom = (data.get('nom') or '').strip()
                cognoms = (data.get('cognoms') or '').strip()
                telefon = (data.get('telefon') or '').strip()
                email = (data.get('email') or '').strip()
                pin = (data.get('pin') or '').strip()
                notes = (data.get('notes') or '').strip()
                data_naixement = (data.get('data_naixement') or '').strip() or None
                edat_raw = data.get('edat')
                edat = None
                if edat_raw is not None and str(edat_raw).strip() != '':
                    try:
                        edat = int(edat_raw)
                    except (ValueError, TypeError):
                        edat = None

                # Si es facilita data_naixement, calcular l'edat automàticament
                if data_naixement:
                    calc_age = calculate_age_from_birthdate(data_naixement)
                    if calc_age is not None:
                        edat = calc_age

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

                    data_alta = data.get('data_alta') or get_now().strftime('%Y-%m-%dT%H:%M:%S')

                    cursor.execute('''
                        INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu, edat, data_naixement)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            nom=excluded.nom,
                            cognoms=excluded.cognoms,
                            telefon=excluded.telefon,
                            email=excluded.email,
                            pin=excluded.pin,
                            notes=excluded.notes,
                            edat=excluded.edat,
                            data_naixement=excluded.data_naixement
                    ''', (student_id, nom, cognoms, telefon, email, pin, data_alta, notes, edat, data_naixement))
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
                    'edat': edat,
                    'data_naixement': data_naixement
                })

                self.send_json({'ok': True, 'id': student_id, 'edat': edat, 'data_naixement': data_naixement, 'message': 'Alumne desat correctament'})
                return

            elif path == '/api/checkin':
                # Check-in / Check-out intel·ligent per codi QR o ID
                code = (data.get('code') or '').strip()
                if not code:
                    self.send_json({'ok': False, 'error': 'Codi d\'alumne buit'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, code, actiu_only=True)

                    if not student:
                        self.send_json({'ok': False, 'error': f'No s\'ha trobat cap alumne actiu amb el codi "{code}"'}, 404)
                        return

                    student_id = student['id']
                    requested_action = (data.get('action') or 'auto').lower()
                    custom_time = data.get('customTime')
                    tipus = data.get('tipus') or ('manual' if requested_action in ('entrada', 'sortida') else 'qr')

                    if custom_time:
                        now = parse_to_local_dt(custom_time)
                    else:
                        now = get_now()

                    now_iso = now.strftime('%Y-%m-%dT%H:%M:%S')
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

                        session_id = f"SES-{now.strftime('%Y%m%d%H%M%S')}-{student_id}"
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

                        entrada_dt = parse_to_local_dt(open_session['entrada'])
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

                    entrada_dt = parse_to_local_dt(sess['entrada'])

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
                        sortida_iso = sortida_dt.strftime('%Y-%m-%dT%H:%M:%S')
                    elif sortida_manual:
                        sortida_dt = parse_to_local_dt(sortida_manual)
                        durada_segons = max(0, int((sortida_dt - entrada_dt).total_seconds()))
                        sortida_iso = sortida_dt.strftime('%Y-%m-%dT%H:%M:%S')
                    else:
                        # Per defecte: durada configurada al taller (1h 30m = 5400 segons)
                        cursor.execute('SELECT valor FROM configuracio WHERE clau = "hores_per_defecte_oblit"')
                        cfg_row = cursor.fetchone()
                        def_dur = cfg_row['valor'] if cfg_row else "01:30:00"
                        parts = [int(p) for p in def_dur.split(':')]
                        durada_segons = parts[0]*3600 + parts[1]*60 + (parts[2] if len(parts) > 2 else 0)
                        sortida_dt = datetime.fromtimestamp(entrada_dt.timestamp() + durada_segons)
                        sortida_iso = sortida_dt.strftime('%Y-%m-%dT%H:%M:%S')

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
                data_compra = data.get('data') or get_now().strftime('%Y-%m-%dT%H:%M:%S')

                if not student_id or hores <= 0:
                    self.send_json({'ok': False, 'error': 'Cal indicar alumne i hores superiors a 0'}, 400)
                    return

                segons = int(round(hores * 3600))
                pack_id = f"PK-{get_now().strftime('%Y%m%d%H%M%S')}-{student_id}"

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
                entrada = data.get('entrada')
                sortida = data.get('sortida')
                data_sess = data.get('data') or (entrada[:10] if entrada else get_now().strftime('%Y-%m-%d'))
                notes = data.get('notes') or ''

                if not student_id or not entrada or not sortida:
                    self.send_json({'ok': False, 'error': 'Cal indicar alumne, hora d\'entrada i hora de sortida'}, 400)
                    return

                entrada_dt = parse_to_local_dt(entrada)
                sortida_dt = parse_to_local_dt(sortida)
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
                        sess_id = f"SES-MANUAL-{get_now().strftime('%Y%m%d%H%M%S')}-{student_id}"
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
                val_regal = 1 if (data.get('val_regal') or data.get('valRegal')) else 0
                codi_val_regal = (data.get('codi_val_regal') or data.get('codiValRegal') or '').strip()
                student_nom = (data.get('student_nom') or data.get('studentNom') or data.get('nom') or '').strip()
                telefon = (data.get('telefon') or '').strip()
                email = (data.get('email') or '').strip()

                if not data_res or not franja_id:
                    self.send_json({'ok': False, 'error': 'Cal indicar data i franja horària'}, 400)
                    return

                # Si han marcat l'opció "Sóc alumne" o han indicat un student_id / codi d'alumne
                is_soc_alumne = bool(data.get('soc_alumne') or data.get('is_student') or data.get('isStudent'))
                if is_soc_alumne or (student_id and not student_id.startswith('CLI-')):
                    with get_db() as conn_check:
                        cur_check = conn_check.cursor()
                        query_code = student_id or student_nom
                        al_found = find_student_by_code(cur_check, query_code, actiu_only=False)
                        if al_found:
                            student_id = al_found['id']
                            if not student_nom:
                                student_nom = f"{al_found['nom']} {al_found['cognoms'] or ''}".strip()
                            if not telefon and al_found.get('telefon'):
                                telefon = str(al_found['telefon']).strip()
                            if not email and al_found.get('email'):
                                email = str(al_found['email']).strip()
                        elif is_soc_alumne and not student_id:
                            student_id = f"ALU-{int(get_now().timestamp())}"

                # Si és un client no alumne (reserva des de la web pública reserva.html)
                if not student_id:
                    if not student_nom or not telefon:
                        self.send_json({'ok': False, 'error': 'Cal indicar el teu nom complet i telèfon de contacte per a la reserva'}, 400)
                        return
                    student_id = f"CLI-{int(get_now().timestamp())}"

                # Validar dia tancat (dilluns/dimarts descans, festiu o vacances)
                estat_dia = is_dia_tancat(data_res)
                if estat_dia['tancat']:
                    self.send_json({'ok': False, 'error': estat_dia['motiu']}, 400)
                    return

                act_list = get_activitats_config()
                act_obj = next((a for a in act_list if a['id'] == activitat_id or a['nom'].lower() == activitat_id or a['nom'].lower() == activitat_nom.lower()), None)
                if not act_obj:
                    act_obj = act_list[0]
                activitat_id = act_obj['id']
                activitat_nom = act_obj['nom']

                if val_regal and 'VAL REGAL' not in notes.upper():
                    val_str = f"[VAL REGAL: {codi_val_regal}]" if codi_val_regal else f"[VAL REGAL: {activitat_nom.upper()}]"
                    notes = f"{notes} {val_str}".strip()

                if is_soc_alumne and 'ALUMNE' not in notes.upper():
                    notes = f"[ALUMNE: {student_id}] {notes}".strip()

                hora_inici_req = (data.get('hora_inici') or data.get('horaInici') or '').strip()
                if val_regal:
                    hora_inici_req = '10:00'
                    hora_fi_req = '12:00'
                else:
                    if not hora_inici_req:
                        if franja_id in INTERVALS_INICI_2H:
                            hora_inici_req = franja_id
                        elif ':' in franja_id and len(franja_id) == 5:
                            hora_inici_req = franja_id
                        else:
                            hora_inici_req = '10:00'

                    hora_fi_req = (data.get('hora_fi') or data.get('horaFi') or '').strip()
                    if not hora_fi_req:
                        hora_fi_req = calcular_hora_fi_2h(hora_inici_req)

                hores_req = float(data.get('hores') or 2.0)

                franges = get_franges_config()
                franja_obj = next((f for f in franges if f['id'] == franja_id or f['nom'] == franja_id), None)
                if not franja_obj:
                    franja_obj = franges[0] if franges else {"id": "M1", "nom": "Matí (10:00 - 13:00)", "inici": "10:00", "fi": "13:00", "hores": 2.0}

                with get_db() as conn:
                    cursor = conn.cursor()
                    if not student_nom or not telefon or not email:
                        cursor.execute('SELECT nom, cognoms, telefon, email FROM alumnes WHERE UPPER(TRIM(id)) = UPPER(TRIM(?))', (student_id,))
                        al = cursor.fetchone()
                        if al:
                            if not student_nom:
                                student_nom = f"{al['nom']} {al['cognoms'] or ''}".strip()
                            if not telefon and al['telefon']:
                                telefon = str(al['telefon']).strip()
                            if not email and al['email']:
                                email = str(al['email']).strip()
                        else:
                            if not student_nom:
                                student_nom = student_id

                    # Comprovar aforament global del taller (màxim 12 places en total per dia)
                    max_cap = get_aforament_maxim()
                    cursor.execute('''
                        SELECT SUM(COALESCE(places, 1)) as total_ocupades FROM reserves
                        WHERE data = ? AND estat = 'confirmada'
                    ''', (data_res,))
                    r_ocup = cursor.fetchone()
                    current_ocupat_dia = r_ocup['total_ocupades'] or 0
                    if current_ocupat_dia + places_demanades > max_cap:
                        lliures = max(0, max_cap - current_ocupat_dia)
                        self.send_json({'ok': False, 'error': f"Aforament complet del taller per a aquest dia. Queden {lliures} places lliures (Màx. {max_cap})."}, 400)
                        return

                    # Comprovar aforament particular de l'activitat
                    cursor.execute('''
                        SELECT SUM(COALESCE(places, 1)) as act_ocupades FROM reserves
                        WHERE data = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat = 'confirmada'
                    ''', (data_res, activitat_id, activitat_nom.lower()))
                    r_act = cursor.fetchone()
                    current_ocupat_act = r_act['act_ocupades'] or 0
                    if current_ocupat_act + places_demanades > act_obj['capacitatMax']:
                        lliures_act = max(0, act_obj['capacitatMax'] - current_ocupat_act)
                        self.send_json({'ok': False, 'error': f"No hi ha prou places per a {activitat_nom}. Queden {lliures_act} places d'aquesta activitat (Màx. {act_obj['capacitatMax']})."}, 400)
                        return

                    res_id = f"RES-{int(get_now().timestamp())}-{student_id}"
                    now_iso = get_now().strftime('%Y-%m-%dT%H:%M:%S')
                    cal_event_id = (data.get('calendar_event_id') or '').strip() or None
                    cursor.execute('''
                        INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, email, estat, hores, notes, created_at, calendar_event_id, val_regal, codi_val_regal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?, ?, ?, ?, ?, ?)
                    ''', (
                        res_id, student_id, student_nom, data_res,
                        hora_inici_req, hora_fi_req,
                        franja_obj['id'], activitat_nom, activitat_id, places_demanades, telefon, email,
                        hores_req, notes, now_iso, cal_event_id, val_regal, codi_val_regal
                    ))
                    conn.commit()

                # Obtenir nom del calendari configurat
                cal_name = 'reserves'
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
                    'email': email,
                    'data': data_res,
                    'hora_inici': hora_inici_req,
                    'hora_fi': hora_fi_req,
                    'franja': franja_obj['id'],
                    'franja_nom': f"{hora_inici_req} - {hora_fi_req} (2h)",
                    'activitat': activitat_nom,
                    'activitat_id': activitat_id,
                    'places': places_demanades,
                    'val_regal': val_regal,
                    'codi_val_regal': codi_val_regal,
                    'soc_alumne': 1 if (is_soc_alumne or (student_id and not student_id.startswith('CLI-'))) else 0,
                    'estat': 'confirmada',
                    'hores': hores_req,
                    'notes': notes,
                    'created_at': now_iso,
                    'calendar_event_id': cal_event_id,
                    'calendar_name': cal_name
                }

                # Sincronitzar reserva a Google Sheets i Google Calendar
                sync_to_google_sheets_async('add_reserva', reserva_dict)

                # Disparar confirmació per WhatsApp Meta Cloud API si està activat
                if telefon:
                    with get_db() as conn_wa:
                        cur_wa = conn_wa.cursor()
                        cur_wa.execute('SELECT valor FROM configuracio WHERE clau = "whatsapp_meta_template_confirmacio"')
                        r_tpl_c = cur_wa.fetchone()
                        tpl_conf = r_tpl_c['valor'].strip() if (r_tpl_c and r_tpl_c['valor']) else 'reserva_confirmada'

                    def _mark_conf_done(wa_res, rid=res_id):
                        try:
                            with get_db() as conn_up:
                                conn_up.cursor().execute("UPDATE reserves SET whatsapp_notif_confirm = 1 WHERE id = ?", (rid,))
                                conn_up.commit()
                        except Exception:
                            pass

                    send_whatsapp_meta_async(
                        telefon,
                        tpl_conf,
                        [student_nom, activitat_nom, data_res, hora_inici_req, str(places_demanades)],
                        on_success_cb=_mark_conf_done
                    )

                self.send_json({
                    'ok': True,
                    'message': 'Reserva confirmada correctament!',
                    'reserva': reserva_dict
                })
                return

            elif path == '/api/reserves/recurrent-preview':
                data_inici = (data.get('data_inici') or data.get('data') or '').strip()
                frequencia = (data.get('frequencia') or 'setmanal').strip().lower()
                repeticions = int(data.get('repeticions') or data.get('sessions') or 4)
                if repeticions < 1:
                    repeticions = 1
                if repeticions > 26:
                    repeticions = 26
                activitat_id = (data.get('activitat_id') or 'torn').strip().lower()
                places_demanades = int(data.get('places') or 1)
                saltar_tancats = bool(data.get('saltar_tancats', True))

                if not data_inici:
                    self.send_json({'ok': False, 'error': "Cal indicar la data d'inici"}, 400)
                    return

                act_list = get_activitats_config()
                act_obj = next((a for a in act_list if a['id'] == activitat_id or a['nom'].lower() == activitat_id), None)
                if not act_obj:
                    act_obj = act_list[0]

                dates_valides, dates_saltades = calculate_recurring_dates(data_inici, frequencia, repeticions, saltar_tancats)
                max_cap = get_aforament_maxim()

                preview = []
                with get_db() as conn:
                    cursor = conn.cursor()
                    for d in dates_valides:
                        cursor.execute("SELECT SUM(COALESCE(places, 1)) as total FROM reserves WHERE data = ? AND estat = 'confirmada'", (d,))
                        tot = cursor.fetchone()['total'] or 0
                        lliures_global = max(0, max_cap - tot)

                        cursor.execute("SELECT SUM(COALESCE(places, 1)) as act_tot FROM reserves WHERE data = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat = 'confirmada'", (d, act_obj['id'], act_obj['nom'].lower()))
                        tot_act = cursor.fetchone()['act_tot'] or 0
                        lliures_act = max(0, act_obj['capacitatMax'] - tot_act)

                        disp = (lliures_global >= places_demanades) and (lliures_act >= places_demanades)

                        preview.append({
                            'data': d,
                            'disponible': disp,
                            'places_lliures_global': lliures_global,
                            'places_lliures_activitat': lliures_act,
                            'capacitat_max_activitat': act_obj['capacitatMax']
                        })

                self.send_json({
                    'ok': True,
                    'preview': preview,
                    'dates_saltades': dates_saltades,
                    'total_sessions': len(preview)
                })
                return

            elif path == '/api/reserves/recurrent':
                student_id = (data.get('student_id') or data.get('studentId') or '').strip()
                data_inici = (data.get('data_inici') or data.get('data') or '').strip()
                frequencia = (data.get('frequencia') or 'setmanal').strip().lower()
                repeticions = int(data.get('repeticions') or data.get('sessions') or 4)
                if repeticions < 1:
                    repeticions = 1
                if repeticions > 26:
                    repeticions = 26

                franja_id = (data.get('franja_id') or data.get('franjaId') or data.get('franja') or 'M1').strip()
                activitat_id = (data.get('activitat_id') or data.get('activitatId') or 'torn').strip().lower()
                activitat_nom = (data.get('activitat') or '').strip()
                places_demanades = int(data.get('places') or data.get('numPersones') or 1)
                if places_demanades < 1:
                    places_demanades = 1
                notes = (data.get('notes') or '').strip()
                student_nom = (data.get('student_nom') or data.get('studentNom') or data.get('nom') or '').strip()
                telefon = (data.get('telefon') or '').strip()
                email = (data.get('email') or '').strip()
                saltar_tancats = bool(data.get('saltar_tancats', True))

                if not data_inici:
                    self.send_json({'ok': False, 'error': "Cal indicar la data d'inici de la reserva recurrent"}, 400)
                    return

                # Validar/resoldre alumne
                if student_id and not student_id.startswith('CLI-'):
                    with get_db() as conn_check:
                        cur_check = conn_check.cursor()
                        al_found = find_student_by_code(cur_check, student_id, actiu_only=False)
                        if al_found:
                            student_id = al_found['id']
                            if not student_nom:
                                student_nom = f"{al_found['nom']} {al_found['cognoms'] or ''}".strip()
                            if not telefon and al_found.get('telefon'):
                                telefon = str(al_found['telefon']).strip()
                            if not email and al_found.get('email'):
                                email = str(al_found['email']).strip()
                if not student_id:
                    if not student_nom or not telefon:
                        self.send_json({'ok': False, 'error': "Cal indicar el nom i telèfon de contacte"}, 400)
                        return
                    student_id = f"CLI-{int(get_now().timestamp())}"

                act_list = get_activitats_config()
                act_obj = next((a for a in act_list if a['id'] == activitat_id or a['nom'].lower() == activitat_id or a['nom'].lower() == activitat_nom.lower()), None)
                if not act_obj:
                    act_obj = act_list[0]
                activitat_id = act_obj['id']
                activitat_nom = act_obj['nom']

                hora_inici_req = (data.get('hora_inici') or data.get('horaInici') or '10:00').strip()
                hora_fi_req = (data.get('hora_fi') or data.get('horaFi') or '').strip()
                if not hora_fi_req:
                    hora_fi_req = calcular_hora_fi_2h(hora_inici_req)
                hores_req = float(data.get('hores') or 2.0)

                franges = get_franges_config()
                franja_obj = next((f for f in franges if f['id'] == franja_id or f['nom'] == franja_id), None)
                if not franja_obj:
                    franja_obj = franges[0] if franges else {"id": "M1", "nom": "Matí (10:00 - 13:00)", "inici": "10:00", "fi": "13:00", "hores": 2.0}

                # Calcular dates
                dates_valides, dates_saltades = calculate_recurring_dates(data_inici, frequencia, repeticions, saltar_tancats)
                if not dates_valides:
                    self.send_json({'ok': False, 'error': "No s'ha trobat cap data vàlida oberta per a aquest període"}, 400)
                    return

                # Comprovar aforament per a totes les dates vàlides abans d'inserir
                dates_amb_conflicte = []
                max_cap = get_aforament_maxim()

                with get_db() as conn:
                    cursor = conn.cursor()
                    if not student_nom or not telefon or not email:
                        cursor.execute('SELECT nom, cognoms, telefon, email FROM alumnes WHERE UPPER(TRIM(id)) = UPPER(TRIM(?))', (student_id,))
                        al = cursor.fetchone()
                        if al:
                            if not student_nom:
                                student_nom = f"{al['nom']} {al['cognoms'] or ''}".strip()
                            if not telefon and al['telefon']:
                                telefon = str(al['telefon']).strip()
                            if not email and al['email']:
                                email = str(al['email']).strip()
                        else:
                            if not student_nom:
                                student_nom = student_id

                    for d_val in dates_valides:
                        cursor.execute('''
                            SELECT SUM(COALESCE(places, 1)) as total_ocupades FROM reserves
                            WHERE data = ? AND estat = 'confirmada'
                        ''', (d_val,))
                        r_ocup = cursor.fetchone()
                        current_ocupat_dia = r_ocup['total_ocupades'] or 0
                        if current_ocupat_dia + places_demanades > max_cap:
                            lliures = max(0, max_cap - current_ocupat_dia)
                            dates_amb_conflicte.append(f"{d_val}: Aforament global complet ({lliures} lliures de {max_cap})")
                            continue

                        cursor.execute('''
                            SELECT SUM(COALESCE(places, 1)) as act_ocupades FROM reserves
                            WHERE data = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat = 'confirmada'
                        ''', (d_val, activitat_id, activitat_nom.lower()))
                        r_act = cursor.fetchone()
                        current_ocupat_act = r_act['act_ocupades'] or 0
                        if current_ocupat_act + places_demanades > act_obj['capacitatMax']:
                            lliures_act = max(0, act_obj['capacitatMax'] - current_ocupat_act)
                            dates_amb_conflicte.append(f"{d_val}: Places de {activitat_nom} completes ({lliures_act} lliures de {act_obj['capacitatMax']})")

                    if dates_amb_conflicte:
                        err_detail = "; ".join(dates_amb_conflicte[:3])
                        if len(dates_amb_conflicte) > 3:
                            err_detail += f" (i {len(dates_amb_conflicte) - 3} dates més)"
                        self.send_json({
                            'ok': False,
                            'error': f"Conflicte d'aforament en algunes dates de la sèrie: {err_detail}",
                            'conflictes': dates_amb_conflicte
                        }, 400)
                        return

                    # Crear sèrie recurrent
                    recurrent_id = f"REC-{int(get_now().timestamp())}-{student_id}"
                    now_iso = get_now().strftime('%Y-%m-%dT%H:%M:%S')
                    created_reserves = []

                    cal_name = 'reserves'
                    cursor.execute("SELECT valor FROM configuracio WHERE clau = 'google_calendar_name'")
                    c_row = cursor.fetchone()
                    if c_row and c_row['valor']:
                        cal_name = c_row['valor']

                    for i, d_val in enumerate(dates_valides):
                        res_id = f"RES-{int(get_now().timestamp())}-{student_id}-{i+1}"
                        session_note = f"[Recurrent {i+1}/{len(dates_valides)}]"
                        combined_notes = f"{session_note} {notes}".strip()

                        cursor.execute('''
                            INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, email, estat, hores, notes, created_at, calendar_event_id, recurrent_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?, ?, ?, NULL, ?)
                        ''', (
                            res_id, student_id, student_nom, d_val,
                            hora_inici_req, hora_fi_req,
                            franja_obj['id'], activitat_nom, activitat_id, places_demanades, telefon, email,
                            hores_req, combined_notes, now_iso, recurrent_id
                        ))

                        r_dict = {
                            'id': res_id,
                            'student_id': student_id,
                            'student_nom': student_nom,
                            'telefon': telefon,
                            'email': email,
                            'data': d_val,
                            'hora_inici': hora_inici_req,
                            'hora_fi': hora_fi_req,
                            'franja': franja_obj['id'],
                            'franja_nom': f"{hora_inici_req} - {hora_fi_req} (2h)",
                            'activitat': activitat_nom,
                            'activitat_id': activitat_id,
                            'places': places_demanades,
                            'estat': 'confirmada',
                            'hores': hores_req,
                            'notes': combined_notes,
                            'created_at': now_iso,
                            'recurrent_id': recurrent_id,
                            'calendar_name': cal_name
                        }
                        created_reserves.append(r_dict)
                        sync_to_google_sheets_async('nova_reserva', r_dict)

                    conn.commit()

                self.send_json({
                    'ok': True,
                    'message': f"S'han creat correctament {len(created_reserves)} reserves recurrents per a {student_nom}.",
                    'recurrent_id': recurrent_id,
                    'total_creades': len(created_reserves),
                    'reserves': created_reserves,
                    'dates_saltades': dates_saltades
                })
                return

            elif path == '/api/reserves/cancel-serie':
                recurrent_id = (data.get('recurrent_id') or '').strip()
                from_date = (data.get('from_date') or data.get('a_partir_de_data') or '').strip()
                if not recurrent_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'identificador de la sèrie recurrent (recurrent_id)"}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    if from_date:
                        cursor.execute("SELECT * FROM reserves WHERE recurrent_id = ? AND data >= ? AND estat != 'cancel·lada'", (recurrent_id, from_date))
                    else:
                        cursor.execute("SELECT * FROM reserves WHERE recurrent_id = ? AND estat != 'cancel·lada'", (recurrent_id,))
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                    if not rows:
                        self.send_json({'ok': False, 'error': "No s'ha trobat cap reserva activa per a aquesta sèrie"}, 404)
                        return

                    if from_date:
                        cursor.execute("UPDATE reserves SET estat = 'cancel·lada' WHERE recurrent_id = ? AND data >= ?", (recurrent_id, from_date))
                    else:
                        cursor.execute("UPDATE reserves SET estat = 'cancel·lada' WHERE recurrent_id = ?", (recurrent_id,))
                    conn.commit()

                for r in rows:
                    r['estat'] = 'cancel·lada'
                    sync_to_google_sheets_async('cancel_reserva', r)

                self.send_json({
                    'ok': True,
                    'message': f"S'han cancel·lat {len(rows)} reserves de la sèrie recurrent i s'han alliberat les places.",
                    'total_cancelades': len(rows),
                    'recurrent_id': recurrent_id
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

                    cal_name = 'reserves'
                    cursor.execute("SELECT valor FROM configuracio WHERE clau = 'google_calendar_name'")
                    c_row = cursor.fetchone()
                    if c_row and c_row['valor']:
                        cal_name = c_row['valor']
                    reserva_dict['calendar_name'] = cal_name

                # Sincronitzar cancel·lació a Google Sheets
                sync_to_google_sheets_async('cancel_reserva', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': 'Reserva cancel·lada correctament i plaça alliberada.',
                    'reserva': reserva_dict
                })
                return

            elif path == '/api/reserves/assistencia':
                res_id = (data.get('id') or '').strip()
                assistit = bool(data.get('assistit', True))
                nou_estat = 'assistit' if assistit else 'confirmada'
                if not res_id:
                    self.send_json({'ok': False, 'error': 'Cal indicar l\'ID de la reserva'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("UPDATE reserves SET estat = ? WHERE id = ?", (nou_estat, res_id))
                    conn.commit()
                    cursor.execute("SELECT * FROM reserves WHERE id = ?", (res_id,))
                    row = cursor.fetchone()
                    reserva_dict = row_to_dict(row) if row else {'id': res_id, 'estat': nou_estat}

                # Sincronitzar estat a Google Sheets
                sync_to_google_sheets_async('update_reserva_estat', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': f"Assistència {'marcada com a present' if assistit else 'restablerta com a pendent'}.",
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

            elif path == '/api/reserves/config-activitats':
                cap_torn = int(data.get('capacitat_max_torn') or data.get('capacitatMaxTorn') or 4)
                cap_modelatge = int(data.get('capacitat_max_modelatge') or data.get('capacitatMaxModelatge') or 8)
                cap_pintar = int(data.get('capacitat_max_pintar') or data.get('capacitatMaxPintar') or 12)

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', ('capacitat_max_torn', str(max(1, cap_torn))))
                    cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', ('capacitat_max_modelatge', str(max(1, cap_modelatge))))
                    cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', ('capacitat_max_pintar', str(max(1, cap_pintar))))
                    conn.commit()

                new_acts = get_activitats_config()
                sync_to_google_sheets_async('save_config', {
                    'capacitat_max_torn': str(cap_torn),
                    'capacitat_max_modelatge': str(cap_modelatge),
                    'capacitat_max_pintar': str(cap_pintar)
                })
                self.send_json({'ok': True, 'message': "Capacitats d'activitat actualitzades correctament!", 'activitats': new_acts})
                return

            elif path == '/api/whatsapp/test':
                tel = (data.get('telefon') or data.get('phone') or '').strip()
                tpl = (data.get('template') or data.get('template_name') or 'reserva_confirmada').strip()
                params_list = data.get('parameters') or ["Alumne Prova", "Torn", "2026-09-09", "10:00", "1"]
                lang = (data.get('language') or 'ca').strip()

                res = send_whatsapp_meta(tel, tpl, params_list, lang)
                status_code = 200 if res.get('ok') else 400
                self.send_json(res, status_code)
                return

            elif path in ('/api/admin/carnet/config', '/api/carnet/config'):
                # Desar configuració de disseny del carnet
                carnet_cfg = data.get('config') if isinstance(data, dict) and 'config' in data else data
                val_str = json.dumps(carnet_cfg, ensure_ascii=False) if isinstance(carnet_cfg, dict) else str(carnet_cfg)
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('carnet_design', ?)", (val_str,))
                    conn.commit()
                sync_to_google_sheets_async('save_config', {'carnet_design': val_str})
                self.send_json({'ok': True, 'success': True, 'message': 'Disseny de carnet actualitzat', 'config': carnet_cfg if isinstance(carnet_cfg, dict) else json.loads(val_str)})
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
    print("SERVIDOR DEL TALLER DE CERÀMICA ACTIU (SQLite + REST API)")
    print("=" * 65)
    print(f"Local (aquest ordinador):   http://localhost:{PORT}")
    print(f"Mòbil / Tauleta (mateixa WiFi): http://{local_ip}:{PORT}")
    print(f"Panell Administració:       http://localhost:{PORT}/admin.html")
    print(f"Escàner QR (Android/Tauleta): http://localhost:{PORT}/scanner.html")
    print(f"Portal de l'Alumne:         http://localhost:{PORT}/alumne.html")
    print(f"Base de Dades SQLite:        {DB_PATH}")
    print("=" * 65)
    print("Prem Ctrl+C per aturar el servidor.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nAturant servidor...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
