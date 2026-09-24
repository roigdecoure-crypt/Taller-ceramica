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
import secrets
import hmac
import base64
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

def hash_password(password, salt=None):
    """Genera un hash criptogràfic segur PBKDF2-HMAC-SHA256 amb salt aleatori de 16 bytes."""
    if not password:
        return ""
    if salt is None:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac('sha256', str(password).encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"pbkdf2:sha256:100000${salt}${key.hex()}"

def verify_password(password, stored_hash):
    """Comprova si una contrasenya coincideix amb el hash desat (o suport de compatibilitat per text pla)."""
    if not password or not stored_hash:
        return False
    pwd_str = str(password).strip()
    stored_str = str(stored_hash).strip()
    if not stored_str.startswith("pbkdf2:sha256:"):
        # Fallback de compatibilitat per a contrasenyes/PINs antics en text pla
        return pwd_str == stored_str
    try:
        parts = stored_str.split('$')
        if len(parts) != 3:
            return False
        iterations = int(parts[0].split(':')[2])
        salt = parts[1]
        expected_hex = parts[2]
        key = hashlib.pbkdf2_hmac('sha256', pwd_str.encode('utf-8'), salt.encode('utf-8'), iterations)
        return secrets.compare_digest(key.hex(), expected_hex)
    except Exception as e:
        print(f"[Auth] Error verificant hash: {e}")
        return False

def save_uploaded_piece_image(base64_data_uri, prefix="peca"):
    """
    Desa una imatge rebuda en format data URI base64 a la carpeta img/peces/
    Retorna la ruta relativa tipus 'img/peces/peca_20260920_abc123.jpg'
    """
    if not base64_data_uri or not isinstance(base64_data_uri, str):
        return ""
    if not base64_data_uri.startswith('data:image/'):
        return base64_data_uri
    try:
        header, encoded = base64_data_uri.split(',', 1)
        ext = "jpg"
        if "image/png" in header:
            ext = "png"
        elif "image/webp" in header:
            ext = "webp"
        data = base64.b64decode(encoded)
        folder = os.path.join(BASE_DIR, 'img', 'peces')
        os.makedirs(folder, exist_ok=True)
        filename = f"{prefix}_{get_now().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(4)}.{ext}"
        filepath = os.path.join(folder, filename)
        with open(filepath, 'wb') as f:
            f.write(data)
        return f"img/peces/{filename}"
    except Exception as e:
        print(f"[Upload] Error desant imatge de peça: {e}")
        return ""

AUTH_SECRET = os.environ.get('AUTH_SECRET') or os.environ.get('SECRET_KEY') or 'roigdecoure-ceramica-secret-token-key-2026'

def generate_hmac_token(role='owner', hours=720):
    """Genera un token signat criptogràficament que no es perd mai encara que el servidor es reiniciï."""
    now = get_now()
    expires = now + timedelta(hours=hours)
    exp_str = expires.strftime('%Y%m%d%H%M%S')
    payload = f"{role}:{exp_str}"
    sig = hmac.new(AUTH_SECRET.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"roig_{role}_{exp_str}_{sig}"

def verify_hmac_token(token):
    """Valida un token signat per HMAC."""
    if not token or not str(token).startswith("roig_"):
        return None
    parts = str(token).strip().split("_")
    if len(parts) != 4:
        return None
    _, role, exp_str, sig = parts
    payload = f"{role}:{exp_str}"
    expected_sig = hmac.new(AUTH_SECRET.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        exp_dt = datetime.strptime(exp_str, '%Y%m%d%H%M%S')
        if get_now() > exp_dt:
            return None
    except Exception:
        return None
    return role

def create_auth_token(role='owner', hours=720):
    """Crea un token de sessió segur (amb signatura HMAC de llarga durada) i el desa a la taula auth_tokens."""
    token = generate_hmac_token(role, hours=hours)
    now = get_now()
    expires = now + timedelta(hours=hours)
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO auth_tokens (token, role, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token, role, now.isoformat(), expires.isoformat())
            )
            # Neteja de tokens caducats
            cursor.execute("DELETE FROM auth_tokens WHERE expires_at < ?", (now.isoformat(),))
            conn.commit()
    except Exception as e:
        print(f"[Auth] Error desant token: {e}")
    return token

def get_token_role(token):
    """Retorna el rol ('owner' o 'staff') associat al token si és vàlid i vigent."""
    if not token:
        return None
    token_clean = str(token).strip()
    if token_clean.lower().startswith("bearer "):
        token_clean = token_clean[7:].strip()
    
    # 1. Comprovar signatura HMAC (immediat, segur i resilient a reinicis)
    hmac_role = verify_hmac_token(token_clean)
    if hmac_role:
        return hmac_role

    # 2. Comprovar base de dades auth_tokens
    now_iso = get_now().isoformat()
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT role FROM auth_tokens WHERE token = ? AND expires_at >= ?",
                (token_clean, now_iso)
            )
            row = cursor.fetchone()
            if row:
                return row['role']
    except Exception as e:
        print(f"[Auth] Error verificant token: {e}")
    return None

def verify_admin_credentials(input_val):
    """
    Verifica la contrasenya / PIN contra Propietari o Treballador.
    Retorna (True, 'owner'|'staff', token) si és correcte, o (False, None, None).
    """
    if not input_val:
        return False, None, None
    clean_val = str(input_val).strip()

    owner_hash = None
    staff_hash = None
    legacy_pin = None

    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT clau, valor FROM configuracio WHERE clau IN ('owner_password_hash', 'staff_password_hash', 'admin_pin')")
            rows = {r['clau']: r['valor'] for r in cursor.fetchall()}
            owner_hash = rows.get('owner_password_hash')
            staff_hash = rows.get('staff_password_hash')
            legacy_pin = rows.get('admin_pin')
    except Exception as e:
        print(f"[Auth] Error llegint hashes d'admin: {e}")

    # Si s'ha actualitzat el PIN clàssic (legacy_pin) a la base de dades i no coincideix amb owner_hash, actualitzar-lo
    if legacy_pin and owner_hash and not verify_password(legacy_pin, owner_hash):
        owner_hash = hash_password(legacy_pin)
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('owner_password_hash', ?)", (owner_hash,))
                conn.commit()
        except Exception:
            pass

    # 1. Comprovar si coincideix amb Propietari (Owner)
    if owner_hash and verify_password(clean_val, owner_hash):
        token = create_auth_token('owner', hours=72)
        return True, 'owner', token

    # Fallback per a legacy_pin o env ADMIN_PIN com a Propietari si no s'ha establert owner_hash
    env_pin = os.environ.get('ADMIN_PIN') or legacy_pin or '1234'
    if not owner_hash and clean_val == env_pin.strip():
        # Inicialitzar automàticament owner_hash
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('owner_password_hash', ?)", (hash_password(clean_val),))
                conn.commit()
        except Exception:
            pass
        token = create_auth_token('owner', hours=72)
        return True, 'owner', token

    # 2. Comprovar si coincideix amb Treballador (Staff)
    if staff_hash and verify_password(clean_val, staff_hash):
        token = create_auth_token('staff', hours=24)
        return True, 'staff', token

    return False, None, None

def verify_admin_pin(input_pin):
    """Compatibilitat retroactiva: verifica si el PIN és vàlid per a qualsevol dels rols."""
    valid, _, _ = verify_admin_credentials(input_pin)
    return valid

def get_request_role(handler, data=None):
    """
    Identifica el rol ('owner' o 'staff') de la petició analitzant capçaleres o cos.
    """
    auth_header = handler.headers.get('Authorization') or handler.headers.get('X-Admin-Token')
    token = None
    if auth_header:
        if auth_header.lower().startswith('bearer '):
            token = auth_header[7:].strip()
        else:
            token = auth_header.strip()
    if not token and data and isinstance(data, dict):
        token = data.get('admin_token') or data.get('token')
    if token:
        role = get_token_role(token)
        if role:
            return role
        # Si el token no és reconegut, provar si és directament el PIN d'administrador
        valid, pin_role, _ = verify_admin_credentials(token)
        if valid:
            return pin_role

    # Fallback si s'envia el PIN a les capçaleres HTTP (ex: X-Admin-PIN)
    pin_hdr = handler.headers.get('X-Admin-PIN') or handler.headers.get('X-Admin-Pin') or handler.headers.get('X-Admin-Password')
    if pin_hdr:
        valid, role, _ = verify_admin_credentials(pin_hdr)
        if valid:
            return role

    # Fallback si s'envia el PIN directament al payload
    if data and isinstance(data, dict) and data.get('pin'):
        valid, role, _ = verify_admin_credentials(data.get('pin'))
        if valid:
            return role
    return None

def require_auth(handler, data=None, allowed_roles=('owner', 'staff')):
    """Valida que la petició tingui una sessió vàlida amb un dels rols permesos (fail-closed)."""
    role = get_request_role(handler, data)
    if not role or role not in allowed_roles:
        handler.send_json({'ok': False, 'error': 'Accés no autoritzat. Cal iniciar sessió.'}, 401)
        return None
    return role

def require_owner(handler, data=None):
    """Valida que la petició tingui exclusivament el rol de Propietari ('owner') (fail-closed)."""
    role = get_request_role(handler, data)
    if role != 'owner':
        handler.send_json({'ok': False, 'error': 'Accés restringit exclusivament al Propietari.'}, 403)
        return None
    return role

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
    <text x="60" y="355" font-family="Roboto, sans-serif" font-size="36" font-weight="500" fill="#1f1f1f">{cognoms if cognoms else 'â'}</text>

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
            ('recurrent_id', "TEXT DEFAULT NULL"),
            ('paga_senyal_link', "TEXT DEFAULT ''")
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

        # Taula de dies festius i vacances personalitzats
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS dies_festius (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data_inici TEXT NOT NULL,
                data_fi TEXT NOT NULL,
                nom TEXT NOT NULL,
                motiu TEXT,
                creat_el TEXT
            )
        ''')

        # Taula de restriccions d'activitats / tallers per dia, setmana, mes o interval
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS restriccions_activitats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data_inici TEXT NOT NULL,
                data_fi TEXT NOT NULL,
                tipus_abast TEXT NOT NULL,
                activitats_permeses TEXT,
                activitats_bloquejades TEXT,
                motiu TEXT,
                torn TEXT DEFAULT 'tot_el_dia',
                creat_el TEXT
            )
        ''')

        # Taula d'activitats / tallers configurats al taller
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS activitats (
                id TEXT PRIMARY KEY,
                nom TEXT NOT NULL,
                descripcio TEXT DEFAULT '',
                capacitat_max INTEGER NOT NULL DEFAULT 4,
                color TEXT NOT NULL DEFAULT '#B91C1C',
                actiu INTEGER NOT NULL DEFAULT 1,
                ordre INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Taula de catàleg d'articles i experiències (preus i hores tancades)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS articles (
                id TEXT PRIMARY KEY,
                nom TEXT NOT NULL,
                descripcio TEXT DEFAULT '',
                preu REAL NOT NULL,
                hores REAL NOT NULL DEFAULT 2.0,
                activitat_id TEXT DEFAULT 'torn',
                edat TEXT DEFAULT 'adult',
                es_val_regal INTEGER NOT NULL DEFAULT 1,
                actiu INTEGER NOT NULL DEFAULT 1,
                ordre INTEGER DEFAULT 0,
                icona TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Taula de gestió integral de Vals Regal
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS vals_regal (
                codi TEXT PRIMARY KEY,
                article_id TEXT,
                titol_experiencia TEXT NOT NULL,
                hores REAL NOT NULL DEFAULT 2.0,
                activitat_id TEXT DEFAULT 'torn',
                nom_comprador TEXT DEFAULT '',
                email_comprador TEXT DEFAULT '',
                telefon_comprador TEXT DEFAULT '',
                nom_destinatari TEXT NOT NULL,
                email_destinatari TEXT DEFAULT '',
                missatge TEXT DEFAULT '',
                preu_pagat REAL DEFAULT 0.0,
                data_creacio TEXT NOT NULL,
                data_caducitat TEXT NOT NULL,
                estat TEXT NOT NULL DEFAULT 'actiu',
                metode_pagament TEXT DEFAULT 'manual',
                transaccio_id TEXT DEFAULT '',
                data_canvi TEXT DEFAULT NULL,
                reserva_id TEXT DEFAULT NULL,
                alumne_id TEXT DEFAULT NULL,
                notes TEXT DEFAULT ''
            )
        ''')

        # Migració de columna telefon_comprador a vals_regal si no existeix
        try:
            cursor.execute("ALTER TABLE vals_regal ADD COLUMN telefon_comprador TEXT DEFAULT ''")
        except Exception:
            pass

        # Taula de gestió integral de Monogràfics
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS monografics (
                id TEXT PRIMARY KEY,
                titol TEXT NOT NULL,
                descripcio TEXT DEFAULT '',
                data_inici TEXT NOT NULL,
                data_fi TEXT NOT NULL,
                durada_dies INTEGER NOT NULL DEFAULT 1,
                hora_inici TEXT NOT NULL,
                hora_fi TEXT NOT NULL,
                preu_total REAL NOT NULL,
                bestreta REAL NOT NULL,
                places_totals INTEGER NOT NULL DEFAULT 6,
                actiu INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Taula d'inscripcions a Monogràfics
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS monografics_inscripcions (
                id TEXT PRIMARY KEY,
                monografic_id TEXT NOT NULL,
                nom TEXT NOT NULL,
                cognoms TEXT DEFAULT '',
                telefon TEXT NOT NULL,
                email TEXT NOT NULL,
                estat_pagament TEXT DEFAULT 'bestreta_pagada',
                import_pagat REAL NOT NULL DEFAULT 0.0,
                stripe_session_id TEXT DEFAULT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (monografic_id) REFERENCES monografics (id)
            )
        ''')

        # Sanititzar qualsevol format_hms corrupte procedent d'imports de Google Sheets (ex: 'Sat Dec 30 1899...')
        try:
            cursor.execute('''
                UPDATE sessions 
                SET format_hms = printf('%02d:%02d:%02d', durada_segons / 3600, (durada_segons % 3600) / 60, durada_segons % 60)
                WHERE format_hms LIKE '%1899%' OR format_hms LIKE '%GMT%' OR length(format_hms) > 10
            ''')
            conn.commit()
        except Exception:
            pass

        # Seeding inicial de tallers si la taula és buida
        cursor.execute('SELECT COUNT(*) as cnt FROM activitats')
        if cursor.fetchone()['cnt'] == 0:
            initial_tallers = [
                ('torn', 'Torn', 'Sessió al torn de terrissaire', 4, '#B91C1C', 1, 1),
                ('modelatge', 'Modelatge', 'Modelat de fang a mà i escultura', 8, '#047857', 1, 2),
                ('pintar', 'Pintar ceràmica', 'Pintura i esmaltat sobre ceràmica', 12, '#1D4ED8', 1, 3)
            ]
            cursor.executemany('''
                INSERT INTO activitats (id, nom, descripcio, capacitat_max, color, actiu, ordre)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', initial_tallers)

            # Sincronitzar amb capacitats de configuracio si ja s'havien modificat
            try:
                cursor.execute('SELECT clau, valor FROM configuracio WHERE clau IN ("capacitat_max_torn", "capacitat_max_modelatge", "capacitat_max_pintar")')
                cfg_rows = cursor.fetchall()
                for row in cfg_rows:
                    val = int(row['valor'])
                    if row['clau'] == 'capacitat_max_torn' and val > 0:
                        cursor.execute('UPDATE activitats SET capacitat_max = ? WHERE id = "torn"', (val,))
                    elif row['clau'] == 'capacitat_max_modelatge' and val > 0:
                        cursor.execute('UPDATE activitats SET capacitat_max = ? WHERE id = "modelatge"', (val,))
                    elif row['clau'] == 'capacitat_max_pintar' and val > 0:
                        cursor.execute('UPDATE activitats SET capacitat_max = ? WHERE id = "pintar"', (val,))
            except Exception:
                pass

        # Franges horàries oficials: Matí (10:00 - 13:00) i Tarda (17:00 - 20:00) de 2 hores (Roig de Coure)
        default_franges_json = json.dumps([
            {"id": "M1", "nom": "Matí (10:00 - 13:00)", "inici": "10:00", "fi": "13:00", "hores": 2.0},
            {"id": "T1", "nom": "Tarda (17:00 - 20:00)", "inici": "17:00", "fi": "20:00", "hores": 2.0}
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
            'admin_pin': os.environ.get('ADMIN_PIN', '1234'),
            'square_app_id': "",
            'square_access_token': "",
            'square_location_id': "",
            'square_environment': "sandbox",
            'square_webhook_signature_key': ""
        }
        for k, v in default_config.items():
            cursor.execute('INSERT OR IGNORE INTO configuracio (clau, valor) VALUES (?, ?)', (k, v))

        # Assegurar columna edat a la taula articles si no existeix
        try:
            cursor.execute("ALTER TABLE articles ADD COLUMN edat TEXT DEFAULT 'adult'")
        except Exception:
            pass

        try:
            cursor.execute("ALTER TABLE restriccions_activitats ADD COLUMN torn TEXT DEFAULT 'tot_el_dia'")
        except Exception:
            pass

        try:
            cursor.execute("ALTER TABLE reserves ADD COLUMN paga_senyal REAL DEFAULT 0.0")
        except Exception:
            pass

        # Migració de seguretat: Taula de tokens de sessió d'administració (Propietari / Treballador)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        ''')

        # Migració de seguretat: Taula de sol·licituds de restabliment de contrasenya (OTP per WhatsApp)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT NOT NULL,
                otp_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (student_id) REFERENCES alumnes (id)
            )
        ''')

        # Assegurar columna password_hash a la taula alumnes
        try:
            cursor.execute("ALTER TABLE alumnes ADD COLUMN password_hash TEXT DEFAULT NULL")
        except Exception:
            pass

        # Taula de fornades del taller (cicle de vida i vídeos d'obertura)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS fornades (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                titol TEXT NOT NULL,
                descripcio TEXT,
                video_url TEXT,
                estat TEXT DEFAULT 'oberta',
                created_at TEXT NOT NULL
            )
        ''')

        # Taula de peces creades pels alumnes
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS peces_alumne (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                fornada_id TEXT,
                nom TEXT NOT NULL,
                tecnica TEXT DEFAULT 'torn',
                foto_cru TEXT,
                foto_cuit TEXT,
                estat TEXT DEFAULT 'assecat',
                avis_recollida INTEGER DEFAULT 0,
                data_recollida TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (student_id) REFERENCES alumnes (id),
                FOREIGN KEY (fornada_id) REFERENCES fornades (id)
            )
        ''')
        try:
            cursor.execute("ALTER TABLE peces_alumne ADD COLUMN notes TEXT")
        except Exception:
            pass

        # Inicialitzar hashes de Propietari i Treballador si no existeixen
        try:
            cursor.execute("SELECT clau, valor FROM configuracio WHERE clau IN ('owner_password_hash', 'staff_password_hash', 'admin_pin')")
            auth_rows = {r['clau']: r['valor'] for r in cursor.fetchall()}
            if not auth_rows.get('owner_password_hash'):
                init_owner_pin = auth_rows.get('admin_pin') or os.environ.get('ADMIN_PIN', '1234')
                cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('owner_password_hash', ?)", (hash_password(init_owner_pin),))
            if not auth_rows.get('staff_password_hash'):
                cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('staff_password_hash', ?)", (hash_password('1234'),))
        except Exception as e:
            print(f"[DB] Error inicialitzant hashes d'admin: {e}")

        # Netejar icones existents a la taula articles
        cursor.execute("UPDATE articles SET icona = '' WHERE icona IS NOT NULL")

        # Seeding i actualització del catàleg oficial d'experiències i bossa d'hores
        official_articles = [
            ('art_torn_adult', 'Experiència Torn (Adult)', 'Sessió pràctica al torn de terrissaire per a adults (2 hores). Aprèn a centrar, pujar i donar forma.', 50.0, 2.0, 'torn', 'adult', 1, 1, 1, ''),
            ('art_torn_infant', 'Experiència Torn (Menor de 12 anys)', 'Iniciació al torn de terrissaire adaptada a menors de 12 anys (2 hores).', 45.0, 2.0, 'torn', 'infant', 1, 1, 2, ''),
            ('art_modelatge_adult', 'Experiència Modelatge (Adult)', 'Modelat de fang amb tècniques de pessic, xurro i planxa per a adults (2 hores). Crea peces úniques.', 50.0, 2.0, 'modelatge', 'adult', 1, 1, 3, ''),
            ('art_modelatge_infant', 'Experiència Modelatge (Menor de 12 anys)', 'Modelat lliure i creatiu de peces ceràmiques adaptat a menors de 12 anys (2 hores).', 45.0, 2.0, 'modelatge', 'infant', 1, 1, 4, ''),
            ('art_pintar_ceramica', 'Pintar ceràmica (Tots els públics)', 'Decora i esmalta peces ceràmiques bescuitades amb colors vius i acabat vidriat (2 hores). Preu únic per a tothom.', 30.0, 2.0, 'pintar', 'tots', 1, 1, 5, ''),
            ('art_hores_adult', 'Bossa d\'hores (Adult)', 'Bossa d\'hores de taller per a adults (mínim 4h). Tarifa per trams: 4-9h (15€/h), 10-19h (14€/h), 20h+ (13€/h). Tria la quantitat que vulguis.', 60.0, 4.0, 'torn', 'adult', 1, 1, 6, ''),
            ('art_hores_infant', 'Bossa d\'hores (Menor de 12 anys)', 'Bossa d\'hores per a menors de 12 anys (mínim 4h). Tarifa per trams: 4-9h (14€/h), 10-19h (13€/h), 20h+ (11€/h). Tria la quantitat que vulguis.', 56.0, 4.0, 'torn', 'infant', 1, 1, 7, '')
        ]
        for art in official_articles:
            cursor.execute('''
                INSERT INTO articles (id, nom, descripcio, preu, hores, activitat_id, edat, es_val_regal, actiu, ordre, icona)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    nom = excluded.nom,
                    descripcio = excluded.descripcio,
                    preu = excluded.preu,
                    hores = excluded.hores,
                    activitat_id = excluded.activitat_id,
                    edat = excluded.edat,
                    es_val_regal = excluded.es_val_regal,
                    actiu = excluded.actiu,
                    ordre = excluded.ordre,
                    icona = ''
            ''', art)

        # Migració de valors antics a configuració oficial si cal
        cursor.execute('UPDATE configuracio SET valor = "Roig de Coure" WHERE clau = "taller_nom" AND (valor = "Taller de Ceràmica" OR valor = "Taller de Ceramica" OR valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "#831D1D" WHERE clau = "brand_primary" AND (valor = "#C25E3A" OR valor = "#7A3026" OR valor IS NULL OR valor = "")')
        cursor.execute('UPDATE configuracio SET valor = "12" WHERE clau = "aforament_maxim_per_franja" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = ? WHERE clau = "franges_horaries" AND (valor NOT LIKE "%T1%" OR valor LIKE "%mati_1%" OR valor LIKE "%F1%")', (default_franges_json,))
        cursor.execute('UPDATE configuracio SET valor = "02:00:00" WHERE clau = "hores_per_defecte_oblit" AND valor = "01:30:00"')
        cursor.execute('UPDATE configuracio SET valor = "https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n" WHERE clau = "stripe_url_adults" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j" WHERE clau = "stripe_url_infantil" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "12" WHERE clau = "edat_tall_infantil" AND (valor = "" OR valor IS NULL)')
        cursor.execute('UPDATE configuracio SET valor = "reserves" WHERE clau = "google_calendar_name" AND (valor = "" OR valor IS NULL OR LOWER(REPLACE(valor, " ", "")) IN ("roigdecoure", "reserves"))')
        cursor.execute('UPDATE configuracio SET valor = "https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec" WHERE clau = "google_sheets_url" AND (valor = "" OR valor IS NULL OR valor LIKE "%AKfycbzfXuSg%")')
        cursor.execute("DELETE FROM reserves WHERE data LIKE '%GMT%' OR data LIKE '%Central European%' OR data LIKE '%hora de verano%' OR id = 'TEST-DEBUG-1'")

        # Normalització d'estats de reserves cancel·lades i lligam de sèries recurrents
        try:
            cursor.execute("UPDATE reserves SET estat = 'cancel·lada' WHERE LOWER(estat) LIKE 'cancel%' OR LOWER(estat) LIKE '%lada'")
        except Exception:
            pass
        try:
            cursor.execute("SELECT id, notes FROM reserves WHERE (recurrent_id IS NULL OR recurrent_id = '') AND notes LIKE '%[Recurrent %'")
            for r_row in cursor.fetchall():
                r_id = r_row['id']
                parts = r_id.split('-')
                if len(parts) >= 4:
                    rec_id = '-'.join(parts[:3])
                    cursor.execute("UPDATE reserves SET recurrent_id = ? WHERE id = ?", (rec_id, r_id))
        except Exception:
            pass

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


class AppsScriptRedirectHandler(urllib.request.HTTPRedirectHandler):
    """
    Gestiona correctament les redireccions 302 de Google Apps Script.
    Quan Google Apps Script rep un POST, respon amb 302 redirigint a
    https://script.googleusercontent.com/macros/echo?... que requereix
    una petició GET sense el body original ni capçaleres Content-Length.
    """
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is not None:
            new_req.method = 'GET'
            new_req.data = None
            for h in ['Content-length', 'Content-Length', 'Content-type', 'Content-Type']:
                new_req.headers.pop(h, None)
        return new_req

def execute_safe_request(req, timeout=30):
    handlers = [AppsScriptRedirectHandler()]
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
                AppsScriptRedirectHandler()
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
                dur_sec = int(s.get('durada_segons', 0))
                raw_hms = str(s.get('format_hms', '')).strip()
                if '1899' in raw_hms or 'GMT' in raw_hms or len(raw_hms) > 10:
                    clean_hms = format_hms(dur_sec)
                else:
                    clean_hms = raw_hms or format_hms(dur_sec)

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
                    dur_sec, clean_hms,
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
                    if k == 'aforament_maxim_per_franja' and (str(v).strip() == '' or v is None):
                        v = '12'
                    if k == 'taller_nom' and str(v) in ('Taller de Ceràmica', 'Taller de Ceramica', ''):
                        v = 'Roig de Coure'
                    if k == 'franges_horaries':
                        try:
                            f_parsed = json.loads(str(v))
                            if isinstance(f_parsed, list) and not any(f.get('id') == 'T1' for f in f_parsed):
                                f_parsed.append({"id": "T1", "nom": "Tarda (17:00 - 20:00)", "inici": "17:00", "fi": "20:00", "hores": 2.0})
                                v = json.dumps(f_parsed, ensure_ascii=False)
                        except Exception:
                            v = default_franges_json
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

def sync_calendar_from_google(target_url=None):
    """
    Comprova si hi ha reserves suprimides a Google Calendar i actualitza SQLite a 'cancel·lada'.
    Garanteix la sincronització bidireccional Google Calendar -> Aplicació.
    """
    url = (target_url or get_google_sheets_url() or '').strip()
    if not url:
        return {'ok': False, 'message': 'Cap URL de Google Sheets configurat.', 'count': 0, 'cancelled_ids': []}

    try:
        sep = '&' if '?' in url else '?'
        req_url = f"{url}{sep}action=check_calendar_sync&t={int(time.time())}"
        req = urllib.request.Request(
            req_url,
            headers={'User-Agent': 'TallerCeramicaBackend/1.0', 'Accept': 'application/json'}
        )
        with execute_safe_request(req, timeout=25) as resp:
            raw = resp.read().decode('utf-8')
            res = json.loads(raw)
            if res.get('status') == 'success':
                cancelled_ids = res.get('cancelled_ids') or []
                updated_reserves = res.get('updated_reserves') or []
                updated_count = 0
                rescheduled_count = 0
                
                with get_db() as conn:
                    cursor = conn.cursor()
                    if cancelled_ids:
                        placeholders = ', '.join(['?'] * len(cancelled_ids))
                        cursor.execute(f"""
                            UPDATE reserves 
                            SET estat = 'cancel·lada' 
                            WHERE id IN ({placeholders}) 
                            AND LOWER(estat) NOT LIKE 'cancel%' 
                            AND LOWER(estat) != 'eliminada'
                        """, cancelled_ids)
                        updated_count = cursor.rowcount

                    actual_updated = []
                    if updated_reserves:
                        for u in updated_reserves:
                            u_id = (u.get('id') or '').strip()
                            u_data = (u.get('data') or '').strip()
                            u_hi = (u.get('hora_inici') or '').strip()
                            u_hf = (u.get('hora_fi') or '').strip()
                            if u_id and u_data and u_hi:
                                cursor.execute("SELECT data, hora_inici, hora_fi FROM reserves WHERE id = ?", (u_id,))
                                cur_res = cursor.fetchone()
                                if cur_res:
                                    cd = str(cur_res['data'] or '').strip()
                                    ch_i = str(cur_res['hora_inici'] or '').strip()
                                    ch_f = str(cur_res['hora_fi'] or '').strip()
                                    # Només actualitzar si realment ha canviat de dia o hora!
                                    if cd != u_data or ch_i != u_hi or (u_hf and ch_f and ch_f != u_hf):
                                        cursor.execute("""
                                            UPDATE reserves 
                                            SET data = ?, hora_inici = ?, hora_fi = ?
                                            WHERE id = ?
                                        """, (u_data, u_hi, u_hf or '', u_id))
                                        if cursor.rowcount > 0:
                                            rescheduled_count += cursor.rowcount
                                            actual_updated.append(u)
                    conn.commit()

                msg_parts = []
                if cancelled_ids:
                    msg_parts.append(f"{len(cancelled_ids)} reserves cancel·lades")
                if rescheduled_count:
                    msg_parts.append(f"{rescheduled_count} reserves mogudes de dia/hora")
                msg = f"Sincronització completada: {', '.join(msg_parts)}." if msg_parts else "Google Calendar i l'aplicació estan al dia."
                return {
                    'ok': True,
                    'count': len(cancelled_ids),
                    'updated_in_db': updated_count,
                    'cancelled_ids': cancelled_ids,
                    'rescheduled_count': rescheduled_count,
                    'updated_reserves': actual_updated,
                    'message': msg
                }
            else:
                return {'ok': False, 'error': res.get('message') or 'Resposta no vàlida de Google Apps Script', 'count': 0, 'cancelled_ids': []}
    except Exception as e:
        print(f"[sync_calendar_from_google] Error: {e}")
        return {'ok': False, 'error': str(e), 'count': 0, 'cancelled_ids': []}

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
            req_dict = {
                'action': action,
                'payload': payload,
                'timestamp': datetime.now().isoformat()
            }
            # Compatibilitat total: si és sync_all o entitats concretes, exposar també a nivell arrel
            if action == 'sync_all' and isinstance(payload, dict):
                req_dict.update(payload)
            elif action == 'sync_alumne':
                req_dict['alumne'] = payload
            elif action in ('checkin', 'add_session', 'checkout', 'update_session', 'force_close', 'manual_session'):
                req_dict['session'] = payload
            elif action == 'add_paquet':
                req_dict['paquet'] = payload
            elif action in ('add_reserva', 'nova_reserva', 'update_reserva', 'cancel_reserva', 'update_reserva_estat'):
                req_dict['reserva'] = payload
            elif action == 'save_config' and isinstance(payload, dict):
                req_dict['config'] = payload

            body = json.dumps(req_dict, ensure_ascii=False).encode('utf-8')

            req = urllib.request.Request(
                url,
                data=body,
                headers={'Content-Type': 'application/json', 'User-Agent': 'TallerCeramicaBackend/1.0'}
            )
            with execute_safe_request(req, timeout=30) as resp:
                raw_resp = resp.read()
                try:
                    res_data = json.loads(raw_resp.decode('utf-8'))
                    if action in ('add_reserva', 'nova_reserva', 'update_reserva', 'update_reserva_estat') and res_data.get('status') == 'success':
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

# Hidratació inicial en segon pla per no bloquejar l'arrencada del servidor
def _hydrate_background():
    try:
        hydrate_from_google_sheets()
    except Exception as e:
        print(f"[Google Sheets] Avís inicialitzant hidratació: {e}")

threading.Thread(target=_hydrate_background, daemon=True).start()

# Treballador periòdic en segon pla per sincronitzar cancel·lacions de Google Calendar
def _calendar_sync_worker():
    time.sleep(45)  # Esperar 45s a l'arrencada
    while True:
        try:
            sync_calendar_from_google()
        except Exception as e:
            print(f"[Background Calendar Sync] Avís: {e}")
        time.sleep(300)  # Cada 5 minuts

threading.Thread(target=_calendar_sync_worker, daemon=True).start()

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
    {"id": "torn", "nom": "Torn", "descripcio": "Sessió al torn de terrissaire", "capacitatMax": 4, "icon": "", "color": "#B91C1C"},
    {"id": "modelatge", "nom": "Modelatge", "descripcio": "Modelat de fang a mà i escultura", "capacitatMax": 8, "icon": "", "color": "#047857"},
    {"id": "pintar", "nom": "Pintar ceràmica", "descripcio": "Pintura i esmaltat sobre ceràmica", "capacitatMax": 12, "icon": "", "color": "#1D4ED8"},
    {"id": "experiencia_torn_adult", "nom": "Experiència al torn adults", "descripcio": "Iniciació pràctica al torn de terrissaire (2h)", "capacitatMax": 4, "icon": "", "color": "#831D1D"},
    {"id": "experiencia_torn_infant", "nom": "Experiència al torn menors 12 anys", "descripcio": "Iniciació al torn per a infants (2h)", "capacitatMax": 4, "icon": "", "color": "#B45309"}
]

def slugify_activity_id(name):
    """Genera un identificador vàlid (slug) a partir del nom del taller"""
    import unicodedata
    nfkd = unicodedata.normalize('NFKD', str(name or ''))
    clean = ''.join([c for c in nfkd if not unicodedata.combining(c)])
    clean = re.sub(r'[^a-zA-Z0-9\s-]', '', clean.lower()).strip()
    slug = re.sub(r'[\s-]+', '-', clean)
    return slug or f"taller-{int(time.time())}"

def get_activitats_config(include_inactive=False):
    """Retorna la llista d'activitats oficials i dinàmiques des de la base de dades"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cfg_caps = {}
            try:
                cursor.execute('SELECT clau, valor FROM configuracio WHERE clau IN ("capacitat_max_torn", "capacitat_max_modelatge", "capacitat_max_pintar")')
                for row in cursor.fetchall():
                    try:
                        cfg_caps[row['clau']] = int(row['valor'])
                    except (ValueError, TypeError):
                        pass
            except Exception:
                pass

            if include_inactive:
                cursor.execute('SELECT id, nom, descripcio, capacitat_max, color, actiu, ordre FROM activitats ORDER BY ordre ASC, id ASC')
            else:
                cursor.execute('SELECT id, nom, descripcio, capacitat_max, color, actiu, ordre FROM activitats WHERE actiu = 1 ORDER BY ordre ASC, id ASC')
            rows = cursor.fetchall()
            if rows:
                result = []
                for r in rows:
                    act_id = r["id"]
                    cap = int(r["capacitat_max"])
                    cfg_key = f"capacitat_max_{act_id}"
                    if cfg_key in cfg_caps and cfg_caps[cfg_key] > 0:
                        cap = cfg_caps[cfg_key]
                    result.append({
                        "id": act_id,
                        "nom": r["nom"],
                        "descripcio": r["descripcio"] or "",
                        "capacitatMax": cap,
                        "icon": "",
                        "color": r["color"] or "#B91C1C",
                        "actiu": bool(r["actiu"]),
                        "ordre": int(r["ordre"] or 0)
                    })
                return result
    except Exception as e:
        print(f"[get_activitats_config] Avís consultant activitats DB: {e}")

    # Fallback predeterminat si no s'ha pogut llegir la taula
    return DEFAULT_ACTIVITATS

# Propietat retrocompatible
ACTIVITATS = DEFAULT_ACTIVITATS

DEFAULT_INFO_ACTIVITATS = {
    "grups": {
        "titol": "Activitats per a Grups i Famílies",
        "subtitol": "Celebracions, aniversaris, trobades i teambuilding",
        "descripcio": "Veniu en parella, família o amics a compartir una experiència al taller. Us preparem una sessió a mida i exclusiva adaptada a les vostres preferències i nivell.\n\nPodeu combinar torn, modelatge o pintar ceràmica.",
        "detalls": "• Sessions a mida de 2 o més hores.\n• Tot el fang ceràmic, eines, davantals i materials inclosos.\n• Acompanyament personalitzat del mestre ceramista.\n• Enfornat i cocció final de totes les peces perquè us les endugueu a casa.",
        "dates": "Horaris a convenir de dimecres a diumenge.",
        "preu": "Preu segons el nombre de persones i durada de l'activitat.",
        "whatsapp_msg": "Hola Roig de Coure! Voldria informació i disponibilitat per a un grup."
    },
    "monografics": {
        "titol": "Cursos Monogràfics i Intensius",
        "subtitol": "Tècniques específiques de taller, esmaltat, torn avançat i peces d'autor",
        "descripcio": "Cursos intensius i tallers monogràfics d'1 a 3 dies, orientats a aprofundir en aspectes concrets del món ceràmic.\n\nIdeal tant per a alumnes que volen avançar de nivell com per a creadors que volen dominar una tècnica específica.",
        "detalls": "",
        "dates": "Programació de noves convocatòries periòdiques. Consulta'ns les pròximes dates disponibles!",
        "preu": "Segons la durada i la temàtica del monogràfic.",
        "whatsapp_msg": "Hola Roig de Coure! Voldria informació sobre els pròxims cursos monogràfics programats."
    },
    "casals": {
        "titol": "Casals de Ceràmica per a Infants",
        "subtitol": "Creativitat, argila i diversió durant les vacances escolars",
        "descripcio": "Casals de ceràmica per a infants i joves durant les vacances d'estiu, Setmana Santa i Nadal.\n\nUn espai segur, inspirador i artístic on aprendre la màgia de transformar el fang amb les mans, provar el torn elèctric i pintar les seves pròpies creacions.",
        "detalls": "",
        "dates": "Vacances d'estiu (juliol i agost), Setmana Santa i vacances de Nadal.",
        "preu": "Inscripcions per setmanes o dies solts.",
        "whatsapp_msg": "Hola Roig de Coure! Voldria informació sobre els casals infantils de ceràmica."
    }
}

def get_activitats_info_config():
    """Retorna la configuració de continguts informatius per a la web (Grups, Monogràfics, Casals)"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT valor FROM configuracio WHERE clau = 'activitats_info_web'")
            row = cursor.fetchone()
            if row and row['valor']:
                loaded = json.loads(row['valor'])
                if isinstance(loaded, dict):
                    res = {}
                    for k, default_val in DEFAULT_INFO_ACTIVITATS.items():
                        res[k] = {**default_val, **(loaded.get(k) or {})}
                    for k, v in loaded.items():
                        if k not in res and isinstance(v, dict):
                            res[k] = v
                    return res
    except Exception as e:
        print(f"[get_activitats_info_config] Error: {e}")
    return DEFAULT_INFO_ACTIVITATS

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

def send_whatsapp_direct(to_phone, message_text):
    """
    Envia un missatge de text directe (com codis de recuperació OTP) per Meta WhatsApp Cloud API.
    """
    phone_clean = re.sub(r'[^0-9]', '', str(to_phone or ''))
    if not phone_clean:
        return {'ok': False, 'error': 'Telèfon buit o no vàlid'}

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
    payload = {
        'messaging_product': 'whatsapp',
        'recipient_type': 'individual',
        'to': phone_clean,
        'type': 'text',
        'text': {
            'body': message_text
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
    except Exception as e:
        print(f"[WhatsApp Direct] Error: {e}")
        return {'ok': False, 'error': str(e)}

def get_wa_gateway_status():
    """Comprova l'estat del microservei Baileys a Node.js (127.0.0.1:3001)"""
    try:
        req = urllib.request.Request('http://127.0.0.1:3001/status', method='GET')
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'ok': True, 'connected': False, 'state': 'offline', 'error': str(e)}

def disconnect_wa_gateway():
    """Desconnecta la sessió de WhatsApp Web de Baileys"""
    try:
        req = urllib.request.Request('http://127.0.0.1:3001/logout', data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'ok': False, 'error': str(e)}

def send_whatsapp_gateway(to_phone, message_text, res_id=None, include_buttons=True, send_logo=True):
    """
    Enviador unificat de WhatsApp per al Taller Roig de Coure:
    1. Prioritza la passarel·la pròpia Baileys (Node.js a 127.0.0.1:3001) vinculada al mòbil del taller (683 633 880) - Cost 0,00 €.
    2. Si el microservei no està vinculat o falla, fa fallback automàtic a Whapi.cloud.
    3. Si Whapi falla, fa fallback a Meta Cloud API.
    """
    phone_clean = re.sub(r'[^0-9]', '', str(to_phone or ''))
    if not phone_clean:
        return {'ok': False, 'error': 'Telèfon buit o no vàlid'}

    if len(phone_clean) == 9 and phone_clean.startswith(('6', '7', '8', '9')):
        phone_clean = '34' + phone_clean

    # 1. Provar microservei Baileys
    try:
        text_to_send = message_text
        if res_id:
            text_to_send += f"\n\nPer gestionar la teva cita respon a aquest xat:\n✅ Escriu *CONFIRMAT* (o *1*) per confirmar\n❌ Escriu *CANCEL·LAR* (o *2*) per cancel·lar\nO bé fes clic a:\n👉 https://roigdecoure.cat/reserva.html?id={res_id}"

        payload = json.dumps({'to': phone_clean, 'text': text_to_send}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request('http://127.0.0.1:3001/send', data=payload, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            if res_data.get('ok'):
                print(f"[Baileys WA Gateway] Missatge enviat amb èxit a {phone_clean} (Reserva: {res_id})")
                return {'ok': True, 'engine': 'baileys', 'response': res_data, 'destinatari': phone_clean}
            else:
                print(f"[Baileys WA Gateway] Resposta no OK: {res_data}. Intentant mètodes alternatius...")
    except Exception as e_node:
        print(f"[Baileys WA Gateway] Microservei local no disponible ({e_node}). Fallback a Whapi...")

    # 2. Fallback a Whapi
    whapi_res = send_whatsapp_whapi(to_phone, message_text, res_id=res_id, include_buttons=include_buttons, send_logo=send_logo)
    if whapi_res.get('ok'):
        return whapi_res

    # 3. Fallback a Meta Cloud API
    try:
        meta_res = send_whatsapp_direct(to_phone, message_text)
        if meta_res.get('ok'):
            return meta_res
    except Exception:
        pass

    return whapi_res

def send_whatsapp_whapi(to_phone, message_text, res_id=None, include_buttons=True, send_logo=True):
    """
    Envia missatge de WhatsApp mitjançant la passarel·la Whapi.cloud (QR vinculat a WhatsApp).
    Suporta botons interactius ([✅ Confirmar], [❌ Cancel·lar]) i capçalera amb logo oficial de Roig de Coure.
    Sense dependència de Facebook ni Meta Developers.
    """
    phone_clean = re.sub(r'[^0-9]', '', str(to_phone or ''))
    if not phone_clean:
        return {'ok': False, 'error': 'Telèfon buit o no vàlid'}

    if len(phone_clean) == 9 and phone_clean.startswith(('6', '7', '8', '9')):
        phone_clean = '34' + phone_clean

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT valor FROM configuracio WHERE clau = 'whapi_token'")
        r_tok = cursor.fetchone()
        token = (r_tok['valor'] or '').strip() if r_tok else ''

    if not token:
        token = 'uc82FwVjn27AqjqD6Mby2vFBzrbp7P7w'

    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'User-Agent': 'TallerCeramicaBackend/1.0'
    }

    logo_url = 'https://roigdecoure.cat/img/logo-bowl.png'

    # Si tenim ID de reserva i volem botons interactius de WhatsApp
    if res_id and include_buttons:
        clean_res_id = str(res_id).strip()
        url_interactive = 'https://gate.whapi.cloud/messages/interactive'
        payload_interactive = {
            'to': phone_clean,
            'type': 'button',
            'body': {
                'text': message_text
            },
            'action': {
                'buttons': [
                    {'type': 'quick_reply', 'id': f'confirm_{clean_res_id}', 'title': '✅ Confirmar'},
                    {'type': 'quick_reply', 'id': f'cancel_{clean_res_id}', 'title': '❌ Cancel·lar'}
                ]
            }
        }
        if send_logo:
            payload_interactive['header'] = {
                'type': 'image',
                'image': {
                    'link': logo_url
                }
            }

        try:
            data_bytes = json.dumps(payload_interactive, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(url_interactive, data=data_bytes, headers=headers, method='POST')
            with execute_safe_request(req, timeout=15) as resp:
                res_json = json.loads(resp.read().decode('utf-8'))
                print(f"[Whapi WhatsApp] Missatge interactiu enviat amb èxit a {phone_clean} (Reserva: {clean_res_id})")
                return {'ok': True, 'response': res_json, 'destinatari': phone_clean, 'type': 'interactive'}
        except Exception as e_inter:
            print(f"[Whapi WhatsApp] Advertència en enviar interactiu: {e_inter}. Fent fallback a text normal...")

    # Enviament de text estàndard si no s'utilitzen botons o si ha fallat l'interactiu
    url_text = 'https://gate.whapi.cloud/messages/text'
    payload_text = {
        'to': phone_clean,
        'body': message_text
    }

    try:
        data_bytes = json.dumps(payload_text, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url_text, data=data_bytes, headers=headers, method='POST')
        with execute_safe_request(req, timeout=15) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            print(f"[Whapi WhatsApp] Missatge enviat amb èxit a {phone_clean}")
            return {'ok': True, 'response': res_json, 'destinatari': phone_clean, 'type': 'text'}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        print(f"[Whapi WhatsApp] HTTP Error {e.code}: {err_body}")
        return {'ok': False, 'error': f"HTTP {e.code}: {err_body}"}
    except Exception as e:
        print(f"[Whapi WhatsApp] Error: {e}")
        return {'ok': False, 'error': str(e)}

def send_whatsapp_whapi_async(to_phone, message_text, on_success_cb=None, res_id=None, include_buttons=True, send_logo=True):
    def _worker():
        res = send_whatsapp_gateway(to_phone, message_text, res_id=res_id, include_buttons=include_buttons, send_logo=send_logo)
        if res.get('ok') and callable(on_success_cb):
            try:
                on_success_cb(res)
            except Exception as ex:
                print(f"[WA Callback Error]: {ex}")
    threading.Thread(target=_worker, daemon=True).start()

def process_wa_inbound_message(sender_phone, text_body, msg_id=None):
    """
    Processa els missatges entrants rebuts pel microservei de WhatsApp (Baileys):
    Si el client respon "1" / "confirmar" -> Confirma la reserva i actualitza Google Sheets / Calendar
    Si el client respon "2" / "cancel·lar" -> Cancel·la la reserva i allibera la plaça
    """
    if not sender_phone:
        return {'ok': False, 'error': 'Telèfon buit'}

    sender_clean = re.sub(r'[^0-9]', '', str(sender_phone))
    text_lower = (text_body or '').lower().strip()

    is_confirm = text_lower in ('1', 'confirmar', 'confirmo', 'si', 'sí', 'ok', 'confirmat') or 'confirm' in text_lower
    is_cancel = text_lower in ('2', 'cancel·lar', 'cancelar', 'anul·lar', 'anular', 'no puc venir', 'no vindré') or 'cancel' in text_lower

    if not is_confirm and not is_cancel:
        return {'ok': True, 'ignored': True, 'reason': 'No és una opció 1 o 2'}

    target_res_id = None
    with get_db() as conn:
        cur = conn.cursor()
        tel_short = sender_clean[-9:] if len(sender_clean) >= 9 else sender_clean
        cur.execute("""
            SELECT id FROM reserves 
            WHERE (telefon LIKE ? OR telefon LIKE ?)
              AND estat NOT IN ('cancel·lada', 'assistit')
            ORDER BY data ASC, hora_inici ASC LIMIT 1
        """, (f"%{tel_short}%", f"%{sender_clean}%"))
        cand = cur.fetchone()
        if cand:
            target_res_id = cand['id']

    if not target_res_id:
        return {'ok': False, 'error': 'No s\'ha trobat cap reserva activa per a aquest telèfon'}

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM reserves WHERE id = ?", (target_res_id,))
        res_row = cur.fetchone()
        if not res_row:
            return {'ok': False, 'error': 'Reserva no trobada'}

        res_dict = row_to_dict(res_row)
        if is_confirm:
            cur.execute("""
                UPDATE reserves 
                SET whatsapp_client_status = 'confirmat', 
                    client_confirmat = 1, 
                    whatsapp_client_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            """, (target_res_id,))
            conn.commit()
            res_dict['whatsapp_client_status'] = 'confirmat'
            res_dict['client_confirmat'] = 1
            print(f"[WA Inbound] Reserva {target_res_id} CONFIRMADA pel client ({sender_clean})")
            sync_to_google_sheets_async('add_reserva', res_dict)
            send_whatsapp_whapi_async(sender_clean, "✅ *Gràcies per confirmar la teva assistència!*\nT'esperem al taller Roig de Coure. Si necessites cap modificació, respon a aquest xat.", None, None, False, False)
        elif is_cancel:
            cur.execute("""
                UPDATE reserves 
                SET estat = 'cancel·lada', 
                    whatsapp_client_status = 'cancelat', 
                    whatsapp_client_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            """, (target_res_id,))
            conn.commit()
            res_dict['estat'] = 'cancel·lada'
            res_dict['whatsapp_client_status'] = 'cancelat'
            print(f"[WA Inbound] Reserva {target_res_id} CANCEL·LADA pel client ({sender_clean})")
            sync_to_google_sheets_async('cancel_reserva', res_dict)
            trigger_n8n_event_async('reserva_cancelada', res_dict)
            send_whatsapp_whapi_async(sender_clean, "❌ *Reserva cancel·lada correctament.*\nHem alliberat la teva plaça. Esperem veure't en una altra ocasió!", None, None, False, False)

    return {'ok': True, 'res_id': target_res_id, 'action': 'confirmat' if is_confirm else 'cancelat'}

_processed_whapi_msg_ids = set()

def sync_whapi_inbound_messages():
    """
    Sincronitza els missatges i respostes entrants de WhatsApp des de Whapi.cloud.
    Processa els clics als botons [✅ Confirmar] i [❌ Cancel·lar] fets pels clients.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT valor FROM configuracio WHERE clau = 'whapi_token'")
        r_tok = cursor.fetchone()
        token = (r_tok['valor'] or '').strip() if r_tok else ''

    if not token:
        token = 'uc82FwVjn27AqjqD6Mby2vFBzrbp7P7w'

    url = 'https://gate.whapi.cloud/messages/list?count=25'
    headers = {
        'Authorization': f'Bearer {token}',
        'User-Agent': 'TallerCeramicaBackend/1.0'
    }

    try:
        req = urllib.request.Request(url, headers=headers, method='GET')
        with execute_safe_request(req, timeout=12) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'ok': False, 'error': str(e)}

    messages = res_data.get('messages', [])
    processed_count = 0

    for m in messages:
        msg_id = m.get('id')
        if not msg_id or msg_id in _processed_whapi_msg_ids:
            continue
        if m.get('from_me'):
            _processed_whapi_msg_ids.add(msg_id)
            continue

        reply = m.get('reply') or {}
        btn_reply = reply.get('buttons_reply') or {}
        btn_id = (btn_reply.get('id') or '').replace('ButtonsV3:', '').strip()
        btn_title = (btn_reply.get('title') or '').lower().strip()
        sender_phone = re.sub(r'[^0-9]', '', str(m.get('from') or ''))

        text_body = ((m.get('text') or {}).get('body') or '').lower().strip()

        is_confirm = btn_id.startswith('confirm_') or ('confirm' in btn_title) or (text_body in ('confirmar', 'confirmo', 'si, confirmo', 'sí, confirmo', 'confirmat', 'ok'))
        is_cancel = btn_id.startswith('cancel_') or ('cancel' in btn_title) or (text_body in ('cancel·lar', 'cancelar', 'anul·lar', 'anular', 'no puc venir', 'no vindré'))

        target_res_id = None
        if btn_id.startswith('confirm_'):
            target_res_id = btn_id.replace('confirm_', '').strip()
        elif btn_id.startswith('cancel_'):
            target_res_id = btn_id.replace('cancel_', '').strip()

        # Si no tenim res_id al botó però tenim el telèfon del client, busquem la seva reserva més propera
        if not target_res_id and (is_confirm or is_cancel) and sender_phone:
            with get_db() as conn:
                cur = conn.cursor()
                tel_short = sender_phone[-9:] if len(sender_phone) >= 9 else sender_phone
                cur.execute("""
                    SELECT id FROM reserves 
                    WHERE (telefon LIKE ? OR telefon LIKE ?)
                      AND estat NOT IN ('cancel·lada', 'assistit')
                    ORDER BY data ASC, hora_inici ASC LIMIT 1
                """, (f"%{tel_short}%", f"%{sender_phone}%"))
                cand = cur.fetchone()
                if cand:
                    target_res_id = cand['id']

        if target_res_id and (is_confirm or is_cancel):
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM reserves WHERE id = ?", (target_res_id,))
                res_row = cur.fetchone()

                if res_row:
                    res_dict = row_to_dict(res_row)
                    if is_confirm:
                        cur.execute("""
                            UPDATE reserves 
                            SET whatsapp_client_status = 'confirmat', 
                                client_confirmat = 1, 
                                whatsapp_client_at = CURRENT_TIMESTAMP 
                            WHERE id = ?
                        """, (target_res_id,))
                        conn.commit()
                        res_dict['whatsapp_client_status'] = 'confirmat'
                        res_dict['client_confirmat'] = 1
                        print(f"[Whapi WhatsApp] Reserva {target_res_id} CONFIRMADA pel client ({sender_phone})")
                        sync_to_google_sheets_async('add_reserva', res_dict)
                        send_whatsapp_whapi_async(sender_phone, "✅ *Gràcies per confirmar la teva assistència!*\nT'esperem al taller Roig de Coure. Si necessites cap modificació, respon a aquest xat.", None, None, False, False)
                    elif is_cancel:
                        cur.execute("""
                            UPDATE reserves 
                            SET estat = 'cancel·lada', 
                                whatsapp_client_status = 'cancelat', 
                                whatsapp_client_at = CURRENT_TIMESTAMP 
                            WHERE id = ?
                        """, (target_res_id,))
                        conn.commit()
                        res_dict['estat'] = 'cancel·lada'
                        res_dict['whatsapp_client_status'] = 'cancelat'
                        print(f"[Whapi WhatsApp] Reserva {target_res_id} CANCEL·LADA pel client ({sender_phone})")
                        sync_to_google_sheets_async('cancel_reserva', res_dict)
                        trigger_n8n_event_async('reserva_cancelada', res_dict)
                        send_whatsapp_whapi_async(sender_phone, "❌ *Reserva cancel·lada correctament.*\nHem alliberat la teva plaça. Esperem veure't en una altra ocasió!", None, None, False, False)

            processed_count += 1

        _processed_whapi_msg_ids.add(msg_id)

    return {'ok': True, 'processed': processed_count}

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

DEFAULT_NOTIFICATION_TEMPLATES = {
    'confirm_subj': 'Confirmació de Reserva: {data} a les {hora}h - {taller_nom}',
    'confirm_email': '''<p>Hola <strong>{nom}</strong>,</p>
<p>La teva reserva al taller ha estat confirmada correctament:</p>
<div style="background: #faf7f2; border: 1px solid #e0d5c1; border-radius: 8px; padding: 14px 18px; margin: 15px 0;">
  <p style="margin: 4px 0;">📅 <strong>Data:</strong> {data}</p>
  <p style="margin: 4px 0;">⏰ <strong>Horari:</strong> {hora}h - {hora_fi}h</p>
  <p style="margin: 4px 0;">🎨 <strong>Activitat:</strong> {activitat}</p>
  <p style="margin: 4px 0;">👥 <strong>Places:</strong> {places}</p>
  <p style="margin: 4px 0;">⏳ <strong>Balanç pack:</strong> {saldo_hores} hores restants</p>
</div>
<p>Recorda portar roba còmoda que es pugui embrutar una mica de fang.</p>
<p style="margin-top: 18px;">Si necessites modificar o cancel·lar la teva cita, pots fer-ho directament amb aquests botons:</p>
<div style="margin: 20px 0;">
  <a href="{enllac_canviar}" style="background: #831D1D; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔄 Canviar de dia o hora</a>
  <a href="{enllac_cancel}" style="background: #ffffff; color: #b91c1c; border: 1.5px solid #b91c1c; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-left: 10px;">❌ Cancel·lar reserva</a>
</div>
<p style="color: #7d6b5c; font-size: 13px; margin-top: 25px;">Taller de Ceràmica {taller_nom} &bull; Tel: {taller_telefon}</p>''',
    'confirm_wa': 'Hola {nom}! T\'hem confirmat la teva reserva a {taller_nom} pel dia {data} a les {hora}h ({activitat}). Per canviar o cancel·lar la teva cita: {enllac_cancel}',

    '48h_subj': 'Recordatori de Reserva (48h): Ens veiem el {data} a les {hora}h!',
    '48h_email': '''<p>Hola <strong>{nom}</strong>,</p>
<p>Et recordem que d'aquí a <strong>48 hores</strong> tens classe de ceràmica al taller:</p>
<div style="background: #faf7f2; border: 1px solid #e0d5c1; border-radius: 8px; padding: 14px 18px; margin: 15px 0;">
  <p style="margin: 4px 0;">📅 <strong>Data:</strong> {data}</p>
  <p style="margin: 4px 0;">⏰ <strong>Horari:</strong> {hora}h</p>
  <p style="margin: 4px 0;">🎨 <strong>Activitat:</strong> {activitat}</p>
</div>
<p>Si no pots assistir, si us plau allibera la plaça perquè un altre company la pugui aprofitar:</p>
<div style="margin: 20px 0;">
  <a href="{enllac_canviar}" style="background: #831D1D; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔄 Canviar dia</a>
  <a href="{enllac_cancel}" style="background: #ffffff; color: #b91c1c; border: 1.5px solid #b91c1c; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-left: 10px;">❌ Cancel·lar reserva</a>
</div>
<p style="color: #7d6b5c; font-size: 13px; margin-top: 25px;">Taller de Ceràmica {taller_nom}</p>''',
    '48h_wa': 'Hola {nom}! Recordatori: d\'aquí a 48h tens classe a {taller_nom} el dia {data} a les {hora}h ({activitat}). Per canviar o cancel·lar: {enllac_cancel}',

    'dia_subj': 'Avui tens classe de ceràmica a les {hora}h! - {taller_nom}',
    'dia_email': '''<p>Hola <strong>{nom}</strong>,</p>
<p>T'esperem <strong>avui mateix a les {hora}h</strong> per a la teva sessió de ceràmica ({activitat})!</p>
<p>Si tens qualsevol imprevist d'última hora, contacta'ns o pots cancel·lar aquí:</p>
<div style="margin: 15px 0;">
  <a href="{enllac_cancel}" style="background: #b91c1c; color: #ffffff; padding: 9px 16px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Gestionar o cancel·lar cita</a>
</div>
<p style="color: #7d6b5c; font-size: 13px; margin-top: 20px;">Fins d'aquí a una estona a {taller_nom}!</p>''',
    'dia_wa': 'Hola {nom}! T\'esperem avui a les {hora}h al taller ({activitat}). Si tens cap imprevist: {enllac_cancel}'
}

def render_notification(event_name, r):
    """
    Renders custom notification templates from configuracio table with dynamic placeholders.
    Returns { event, student_nom, email, telefon, email_assumpte, email_html, wa_missatge, wa_link, enllac_cancel, enllac_canviar }
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT clau, valor FROM configuracio WHERE clau LIKE 'notif_%' OR clau IN ('taller_nom', 'taller_telefon', 'site_url')")
        cfg = {row['clau']: row['valor'] for row in cursor.fetchall()}

    prefix = 'confirm'
    if '48h' in event_name:
        prefix = '48h'
    elif 'dia' in event_name:
        prefix = 'dia'

    subj_tpl = cfg.get(f'notif_{prefix}_email_subj') or DEFAULT_NOTIFICATION_TEMPLATES[f'{prefix}_subj']
    body_tpl = cfg.get(f'notif_{prefix}_email_body') or DEFAULT_NOTIFICATION_TEMPLATES[f'{prefix}_email']
    wa_tpl = cfg.get(f'notif_{prefix}_wa') or DEFAULT_NOTIFICATION_TEMPLATES[f'{prefix}_wa']

    taller_nom = cfg.get('taller_nom') or 'Roig de Coure'
    taller_telefon = cfg.get('taller_telefon') or '+34 600 000 000'
    base_url = (cfg.get('site_url') or '').strip().rstrip('/')
    if not base_url:
        base_url = 'https://roigdecoure.cat'

    res_id = str(r.get('id') or '')
    nom = r.get('student_nom') or 'Client'
    data_res = r.get('data') or ''
    hora_inici = r.get('hora_inici') or '10:00'
    hora_fi = r.get('hora_fi') or '12:00'
    act = r.get('activitat') or 'Torn Lliure'
    places = str(r.get('places') or 1)
    saldo = str(r.get('saldo_restant') if r.get('saldo_restant') is not None else '')
    if not saldo or saldo == '--':
        sid = r.get('student_id')
        if sid and not str(sid).startswith('CLI-'):
            try:
                b_info = get_student_balance(sid)
                if b_info and b_info.get('humanBalance'):
                    saldo = b_info.get('humanBalance')
            except Exception:
                pass
    if not saldo:
        saldo = '--'

    enllac_cancel = f"{base_url}/reserva.html?accio=cancel&id={urllib.parse.quote(res_id)}"
    enllac_canviar = f"{base_url}/reserva.html"

    replacements = {
        '{nom}': nom,
        '{data}': data_res,
        '{hora}': hora_inici,
        '{hora_fi}': hora_fi,
        '{activitat}': act,
        '{places}': places,
        '{saldo_hores}': saldo,
        '{enllac_cancel}': enllac_cancel,
        '{enllac_canviar}': enllac_canviar,
        '{taller_nom}': taller_nom,
        '{taller_telefon}': taller_telefon
    }

    subj_rendered = subj_tpl
    body_rendered = body_tpl
    wa_rendered = wa_tpl
    for k, v in replacements.items():
        subj_rendered = subj_rendered.replace(k, str(v))
        body_rendered = body_rendered.replace(k, str(v))
        wa_rendered = wa_rendered.replace(k, str(v))

    # Construir HTML corporatiu per a email
    email_html = f'''<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e0d5c1; border-radius: 10px; background-color: #faf7f2; color: #2d251e; line-height: 1.6;">
  <div style="border-bottom: 2px solid #831D1D; padding-bottom: 12px; margin-bottom: 20px;">
    <h2 style="color: #831D1D; margin: 0; font-size: 24px;">{taller_nom}</h2>
    <span style="font-size: 13px; color: #7d6b5c;">Taller de Ceràmica &bull; Notificació Oficial</span>
  </div>
  {body_rendered}
</div>'''

    tel_raw = re.sub(r'[^0-9]', '', str(r.get('telefon') or ''))
    if len(tel_raw) == 9:
        tel_raw = '34' + tel_raw
    wa_url = f"https://wa.me/{tel_raw}?text={urllib.parse.quote(wa_rendered)}" if tel_raw else ''

    return {
        'event': event_name,
        'id': res_id,
        'student_id': r.get('student_id') or '',
        'student_nom': nom,
        'email': r.get('email') or '',
        'telefon': r.get('telefon') or '',
        'email_assumpte': subj_rendered,
        'email_html': email_html,
        'wa_missatge': wa_rendered,
        'wa_link': wa_url,
        'enllac_cancel': enllac_cancel,
        'enllac_canviar': enllac_canviar,
        'data': data_res,
        'hora_inici': hora_inici,
        'hora_fi': hora_fi,
        'activitat': act,
        'places': places,
        'saldo_restant': saldo
    }

def trigger_n8n_event_async(event_name, payload):
    """
    Renderitza la plantilla personalitzada i envia l'esdeveniment a n8n Cloud.
    Non-blocking / asíncron.
    """
    def _worker():
        try:
            rendered = render_notification(event_name, payload)
            url = 'https://roigdecoure.app.n8n.cloud/webhook/taller-reserva-notificacio'
            data_bytes = json.dumps(rendered, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={'Content-Type': 'application/json', 'User-Agent': 'TallerCeramicaBackend/1.0'},
                method='POST'
            )
            with execute_safe_request(req, timeout=10) as resp:
                if resp.status == 200:
                    res_body = json.loads(resp.read().decode('utf-8'))
                    print(f"[n8n Cloud] Notificació ({event_name}) enviada correctament a {rendered.get('student_nom')}")
        except Exception as e:
            print(f"[n8n Cloud] Avís en segon pla (no bloquejant): {e}")

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
                            WHERE data = ? AND estat IN ('confirmada', 'pendent_paga_senyal') 
                              AND (whatsapp_notif_dia IS NULL OR whatsapp_notif_dia = 0)
                              AND (COALESCE(telefon, '') != '' OR COALESCE(email, '') != '')
                        """, (today_str,))
                        res_today = [row_to_dict(x) for x in cursor.fetchall()]

                    for r in res_today:
                        nom = r.get('student_nom') or 'Client'
                        hora = r.get('hora_inici') or '10:00'
                        act = r.get('activitat') or 'Torn'
                        def _mark_done(res_id=r['id']):
                            try:
                                with get_db() as c_conn:
                                    c_conn.cursor().execute("UPDATE reserves SET whatsapp_notif_dia = 1 WHERE id = ?", (res_id,))
                                    c_conn.commit()
                            except Exception:
                                pass

                        if r.get('telefon'):
                            notif_dia = render_notification('recordatori_dia', r)
                            send_whatsapp_whapi_async(r['telefon'], notif_dia.get('wa_missatge') or '', on_success_cb=lambda res, rid=r['id']: _mark_done(rid), res_id=r['id'], include_buttons=True, send_logo=True)
                        else:
                            _mark_done(r['id'])

                        # Disparar workflow automàtic n8n (Email + WhatsApp)
                        trigger_n8n_event_async('recordatori_dia', r)

                # 2. Recordatoris a 48 hores vista (data = avui + 2 dies)
                date_48h = (now + timedelta(days=2)).strftime('%Y-%m-%d')
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT valor FROM configuracio WHERE clau = "whatsapp_meta_template_recordatori_48h"')
                    r_tpl48 = cursor.fetchone()
                    tpl_48 = r_tpl48['valor'].strip() if (r_tpl48 and r_tpl48['valor']) else 'reserva_recordatori_48h'

                    cursor.execute("""
                        SELECT * FROM reserves 
                        WHERE data = ? AND estat IN ('confirmada', 'pendent_paga_senyal') 
                          AND (whatsapp_notif_48h IS NULL OR whatsapp_notif_48h = 0)
                          AND (COALESCE(telefon, '') != '' OR COALESCE(email, '') != '')
                    """, (date_48h,))
                    res_48 = [row_to_dict(x) for x in cursor.fetchall()]

                for r in res_48:
                    nom = r.get('student_nom') or 'Client'
                    data_res = r.get('data')
                    hora = r.get('hora_inici') or '10:00'
                    act = r.get('activitat') or 'Torn'
                    def _mark_done_48(res_id=r['id']):
                        try:
                            with get_db() as c_conn:
                                c_conn.cursor().execute("UPDATE reserves SET whatsapp_notif_48h = 1 WHERE id = ?", (res_id,))
                                c_conn.commit()
                        except Exception:
                            pass

                    if r.get('telefon'):
                        notif_48 = render_notification('recordatori_48h', r)
                        send_whatsapp_whapi_async(r['telefon'], notif_48.get('wa_missatge') or '', on_success_cb=lambda res, rid=r['id']: _mark_done_48(rid), res_id=r['id'], include_buttons=True, send_logo=True)
                    else:
                        _mark_done_48(r['id'])

                    # Disparar workflow automàtic n8n (Email + WhatsApp)
                    trigger_n8n_event_async('recordatori_48h', r)


            except Exception as e:
                print(f"[WhatsApp Scheduler] Avís: {e}")

            # Comprovar cada 15 minuts
            time.sleep(900)

    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()

def start_whapi_listener():
    """
    Escoltador en segon pla que sincronitza cada 6 segons les respostes
    dels clients a WhatsApp ([✅ Confirmar] i [❌ Cancel·lar]).
    """
    def _listener_loop():
        time.sleep(5)
        while True:
            try:
                sync_whapi_inbound_messages()
            except Exception:
                pass
            time.sleep(6)

    t_whapi = threading.Thread(target=_listener_loop, daemon=True)
    t_whapi.start()

def start_wa_gateway():
    """
    Inicia el microservei Node.js de Baileys (wa_service.js) en segon pla
    per connectar-se al WhatsApp Web del taller (683 633 880) sense cost.
    """
    import shutil
    import subprocess
    node_bin = shutil.which('node')
    if not node_bin:
        print("[WA Gateway] Node.js no disponible a l'entorn local. A Render s'executarà dins el contenidor Docker.")
        return

    wa_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wa_service.js')
    if not os.path.exists(wa_script):
        print(f"[WA Gateway] No s'ha trobat el fitxer {wa_script}")
        return

    def _run_gateway():
        while True:
            try:
                print(f"[WA Gateway] Llançant microservei Baileys: {node_bin} {wa_script}...")
                p = subprocess.Popen([node_bin, wa_script], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
                for line in p.stdout:
                    line_str = line.strip()
                    if line_str:
                        print(f"[Node WA] {line_str}")
                p.wait()
                print(f"[WA Gateway] Procés Node ha finalitzat amb codi {p.returncode}. Reiniciant en 2s...")
            except Exception as e:
                print(f"[WA Gateway Error]: {e}")
            time.sleep(2)

    t = threading.Thread(target=_run_gateway, daemon=True)
    t.start()

# Iniciar scheduler, listener Whapi i microservei Baileys WhatsApp
try:
    start_whatsapp_scheduler()
    start_whapi_listener()
    start_wa_gateway()
except Exception as e:
    print(f"[WhatsApp Startup Error]: {e}")

INTERVALS_INICI_2H = [
    "10:00", "10:15", "10:30", "10:45", "11:00",
    "17:00", "17:15", "17:30", "17:45", "18:00"
]

def calcular_preu_hores_trams(hores, es_infant=False):
    """
    Calcula el preu per hora i total segons les franges establertes.
    Compra mínima: 4 hores.
    Adults:
      - 4h a 9h:  15 €/h
      - 10h a 19h: 14 €/h
      - 20h o més: 13 €/h
    Mainada fins a 12 anys:
      - 4h a 9h:  14 €/h
      - 10h a 19h: 13 €/h
      - 20h o més: 11 €/h
    """
    try:
        h = max(4, int(hores))  # Compra mínima de 4 hores
    except Exception:
        h = 10

    if not es_infant:
        if h <= 9:
            preu_hora = 15.0
            franja_desc = "4h a 9h (15 €/h)"
        elif h <= 19:
            preu_hora = 14.0
            franja_desc = "10h a 19h (14 €/h)"
        else:
            preu_hora = 13.0
            franja_desc = "20h o més (13 €/h)"
    else:
        if h <= 9:
            preu_hora = 14.0
            franja_desc = "4h a 9h (14 €/h)"
        elif h <= 19:
            preu_hora = 13.0
            franja_desc = "10h a 19h (13 €/h)"
        else:
            preu_hora = 11.0
            franja_desc = "20h o més (11 €/h)"

    total = round(h * preu_hora, 2)
    return h, preu_hora, total, franja_desc

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
    {"id": "M1", "nom": "Matí (10:00 - 13:00)", "inici": "10:00", "fi": "13:00", "hores": 2.0},
    {"id": "T1", "nom": "Tarda (17:00 - 20:00)", "inici": "17:00", "fi": "20:00", "hores": 2.0}
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

    # Festius i vacances personalitzats configurats a la base de dades
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, nom, motiu, data_inici, data_fi
                FROM dies_festius
                WHERE data_inici <= ? AND data_fi >= ?
                ORDER BY id DESC LIMIT 1
            ''', (data_str, data_str))
            row = cursor.fetchone()
            if row:
                nom_festiu = row['nom']
                motiu_festiu = (row['motiu'] or '').strip()
                desc = f"{nom_festiu} ({motiu_festiu})" if motiu_festiu and motiu_festiu != nom_festiu else nom_festiu
                return {
                    'tancat': True,
                    'motiu': f"Tancat per {desc}.",
                    'es_personalitzat': True,
                    'festiu_id': row['id'],
                    'festiu_nom': nom_festiu
                }
    except Exception:
        pass

    return {'tancat': False, 'motiu': ''}

def get_restriccions_dia(data_str, torn_filtre=None):
    """
    Retorna les restriccions d'activitats/tallers per a una data concreta i opcionalment
    per a un torn concret ('mati' o 'tarda').
    """
    res = {
        'te_restriccio': False,
        'permeses': [],
        'bloquejades': [],
        'motius': []
    }
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, data_inici, data_fi, tipus_abast, activitats_permeses, activitats_bloquejades, motiu, torn
                FROM restriccions_activitats
                WHERE data_inici <= ? AND data_fi >= ?
                ORDER BY id ASC
            ''', (data_str, data_str))
            rows = cursor.fetchall()
            if not rows:
                return res

            bloquejades_set = set()
            permeses_set = set()
            motius_actius = []

            for r in rows:
                r_torn = (r['torn'] if 'torn' in r.keys() else 'tot_el_dia') or 'tot_el_dia'
                if torn_filtre and r_torn not in ('tot_el_dia', torn_filtre):
                    continue

                if r['motiu'] and r['motiu'].strip():
                    motius_actius.append(r['motiu'].strip())

                # Parsing activitats_bloquejades
                bloq_raw = (r['activitats_bloquejades'] or '').strip()
                if bloq_raw.startswith('['):
                    try:
                        for b in json.loads(bloq_raw):
                            bloquejades_set.add(str(b).strip().lower())
                    except Exception:
                        pass
                elif bloq_raw:
                    for b in bloq_raw.split(','):
                        if b.strip():
                            bloquejades_set.add(b.strip().lower())

                # Parsing activitats_permeses
                perm_raw = (r['activitats_permeses'] or '').strip()
                if perm_raw.startswith('['):
                    try:
                        for p in json.loads(perm_raw):
                            permeses_set.add(str(p).strip().lower())
                    except Exception:
                        pass
                elif perm_raw:
                    for p in perm_raw.split(','):
                        if p.strip():
                            permeses_set.add(p.strip().lower())

            all_acts = [a['id'].lower() for a in get_activitats_config()]
            if permeses_set:
                for act_id in all_acts:
                    if act_id not in permeses_set:
                        bloquejades_set.add(act_id)

            if bloquejades_set:
                res['te_restriccio'] = True
                res['motius'] = motius_actius
                res['bloquejades'] = list(bloquejades_set)
                res['permeses'] = [a for a in all_acts if a not in bloquejades_set]
    except Exception:
        pass

    return res

def calculate_recurring_dates(start_date_str, frequency='setmanal', repetitions=4, skip_closed=True, max_search_steps=150, activitat_id=None, interval_days=None):
    """
    Genera una llista de dates ISO (YYYY-MM-DD) segons la freqüència o interval de dies i nombre de sessions.
    Suporta: diària/consecutiva (1 dia), cada 2 dies, cada 3 dies, setmanal (7 dies), quinzenal (14 dies), mensual o personalitzada (interval_days).
    """
    try:
        cur_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
    except Exception:
        cur_date = get_now().date()

    valid_dates = []
    skipped_dates = []
    step = 0
    search_limit = max(max_search_steps, repetitions * 6)

    # Determinar el pas en dies
    delta_days = None
    if interval_days and int(interval_days) > 0:
        delta_days = int(interval_days)
    elif frequency in ('diaria', 'diari', 'dies_consecutius', '1_dia', 'consecutiu'):
        delta_days = 1
    elif frequency in ('cada_2_dies', '2_dies'):
        delta_days = 2
    elif frequency in ('cada_3_dies', '3_dies'):
        delta_days = 3
    elif frequency == 'quinzenal':
        delta_days = 14
    elif frequency == 'mensual':
        delta_days = None
    else: # setmanal per defecte
        delta_days = 7

    while len(valid_dates) < repetitions and step < search_limit:
        step += 1
        d_str = cur_date.strftime('%Y-%m-%d')
        closed_info = is_dia_tancat(d_str)

        if closed_info['tancat']:
            skipped_dates.append({'data': d_str, 'motiu': closed_info['motiu']})
        else:
            restr = get_restriccions_dia(d_str) if activitat_id else {'te_restriccio': False, 'bloquejades': []}
            if restr['te_restriccio'] and activitat_id and activitat_id.lower() in restr['bloquejades']:
                motiu_r = f"Activitat {activitat_id} restringida ({', '.join(restr['motius'])})" if restr['motius'] else f"Activitat {activitat_id} restringida"
                skipped_dates.append({'data': d_str, 'motiu': motiu_r})
            else:
                valid_dates.append(d_str)

        if frequency == 'mensual' and not delta_days:
            year = cur_date.year + (cur_date.month // 12)
            month = (cur_date.month % 12) + 1
            day = min(cur_date.day, 28)
            cur_date = date(year, month, day)
        else:
            cur_date += timedelta(days=delta_days if delta_days else 7)

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
                    if not any(f.get('id') == 'T1' for f in fr):
                        fr.append({"id": "T1", "nom": "Tarda (17:00 - 20:00)", "inici": "17:00", "fi": "20:00", "hores": 2.0})
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
            WHERE r.data = ? AND r.estat IN ('confirmada', 'pendent_paga_senyal')
            ORDER BY r.hora_inici ASC
        ''', (data_str,))
        active_reserves = [row_to_dict(x) for x in cursor.fetchall()]

    # Separar reserves per torn / franja
    restr_dia = get_restriccions_dia(data_str)

    total_ocupades_dia = sum(int(r.get('places') or 1) for r in active_reserves)
    total_places_dia = max_cap * len(franges)
    places_lliures_dia = max(0, total_places_dia - total_ocupades_dia)

    result_franges = []
    all_intervals = []

    for f in franges:
        f_id = f['id']
        f_inici = f.get('inici') or '10:00'
        is_tarda = (f_id == 'T1' or f_inici >= '14:00')

        # Reserves d'aquesta franja
        if is_tarda:
            res_franja = [r for r in active_reserves if (r.get('franja') == 'T1' or (r.get('hora_inici') or '10:00') >= '14:00')]
            f_intervals_inici = ["17:00", "17:15", "17:30", "17:45", "18:00"]
        else:
            res_franja = [r for r in active_reserves if (r.get('franja') == 'M1' or (r.get('hora_inici') or '10:00') < '14:00')]
            f_intervals_inici = ["10:00", "10:15", "10:30", "10:45", "11:00"]

        ocupat_franja = sum(int(r.get('places') or 1) for r in res_franja)
        lliures_franja = max(0, max_cap - ocupat_franja)
        complet_franja = (lliures_franja == 0)

        if lliures_franja == 0:
            estat_franja = 'complet'
        elif lliures_franja <= 3 and ocupat_franja > 0:
            estat_franja = 'ultimes_places'
        else:
            estat_franja = 'lliure'

        # Ocupació per activitat en aquesta franja amb comprovació de torn (Matí o Tarda)
        torn_franja = 'tarda' if is_tarda else 'mati'
        restr_franja = get_restriccions_dia(data_str, torn_filtre=torn_franja)
        ocupacio_per_act = {}
        activitats_franja = []
        for act in activitats_list:
            act_id = act['id']
            act_nom = act['nom'].lower()
            is_blocked = restr_franja['te_restriccio'] and act_id.lower() in restr_franja['bloquejades']
            if act_id in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in act_id:
                ocupat_act = sum(int(r.get('places') or 1) for r in res_franja if (r.get('activitat_id') or '').lower() in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in (r.get('activitat_id') or '').lower() or 'torn' in (r.get('activitat') or '').lower())
            else:
                ocupat_act = sum(int(r.get('places') or 1) for r in res_franja if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act_nom)
            ocupacio_per_act[act_id] = ocupat_act
            capacitat_max_act = act['capacitatMax']
            lliures_act = max(0, capacitat_max_act - ocupat_act)
            places_efectives = 0 if is_blocked else min(lliures_franja, lliures_act)
            activitats_franja.append({
                'id': act_id,
                'nom': act['nom'],
                'icon': act['icon'],
                'color': act['color'],
                'capacitatMax': capacitat_max_act,
                'ocupat': ocupat_act,
                'placesDisponibles': places_efectives,
                'complet': places_efectives == 0,
                'bloquejada': is_blocked,
                'motiuRestriccio': f"Taller restringit ({', '.join(restr_franja['motius'])})" if (is_blocked and restr_franja['motius']) else ("Taller no disponible aquest torn" if is_blocked else "")
            })

        # Intervals per a aquesta franja
        intervals_franja = []
        for h_ini in f_intervals_inici:
            h_fi = calcular_hora_fi_2h(h_ini)
            inter_obj = {
                'id': h_ini,
                'inici': h_ini,
                'fi': h_fi,
                'hores': 2.0,
                'nom': f"{h_ini} - {h_fi} (2h)",
                'placesLliures': lliures_franja,
                'estaComplet': complet_franja
            }
            intervals_franja.append(inter_obj)
            all_intervals.append(inter_obj)

        result_franges.append({
            'id': f_id,
            'nom': f.get('nom'),
            'inici': f.get('inici'),
            'fi': f.get('fi'),
            'hores': float(f.get('hores', 2.0)),
            'totalPlaces': max_cap,
            'placesOcupades': ocupat_franja,
            'placesLliures': lliures_franja,
            'estat': estat_franja,
            'estaComplet': complet_franja,
            'ocupacioPerActivitat': ocupacio_per_act,
            'activitats': activitats_franja,
            'reserves': res_franja,
            'intervals': intervals_franja
        })

    # Activitats per defecte / dia
    activitats_dia = []
    for act in activitats_list:
        act_id = act['id']
        is_blocked = restr_dia['te_restriccio'] and act_id.lower() in restr_dia['bloquejades']
        if act_id in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in act_id:
            total_act_ocupat = sum(int(r.get('places') or 1) for r in active_reserves if (r.get('activitat_id') or '').lower() in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in (r.get('activitat_id') or '').lower() or 'torn' in (r.get('activitat') or '').lower())
        else:
            total_act_ocupat = sum(int(r.get('places') or 1) for r in active_reserves if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act['nom'].lower())
        lliures_act = max(0, act['capacitatMax'] - total_act_ocupat)
        disp_dia = 0 if is_blocked else min(places_lliures_dia, lliures_act)
        activitats_dia.append({
            'id': act_id,
            'nom': act['nom'],
            'icon': act['icon'],
            'color': act['color'],
            'capacitatMax': act['capacitatMax'],
            'ocupat': total_act_ocupat,
            'placesDisponibles': disp_dia,
            'complet': disp_dia == 0,
            'bloquejada': is_blocked,
            'motiuRestriccio': f"Taller restringit ({', '.join(restr_dia['motius'])})" if (is_blocked and restr_dia['motius']) else ("Taller no disponible aquest dia" if is_blocked else "")
        })

    return {
        'data': data_str,
        'tancat': False,
        'motiu': '',
        'aforamentMaxim': max_cap,
        'totalPlacesDia': total_places_dia,
        'totalOcupadesDia': total_ocupades_dia,
        'placesLliuresDia': places_lliures_dia,
        'franges': result_franges,
        'intervals': all_intervals,
        'activitats': activitats_dia,
        'teRestriccio': restr_dia['te_restriccio'],
        'activitatsPermeses': restr_dia['permeses'] if restr_dia['te_restriccio'] else [a['id'] for a in activitats_list],
        'activitatsBloquejades': restr_dia['bloquejades'] if restr_dia['te_restriccio'] else [],
        'motiusRestriccio': restr_dia['motius']
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
            WHERE data >= ? AND data <= ? AND estat IN ('confirmada', 'pendent_paga_senyal')
        ''', (start_date, end_date))
        month_reserves = [row_to_dict(x) for x in cursor.fetchall()]

        cursor.execute('''
            SELECT id, data_inici, data_fi, nom, motiu
            FROM dies_festius
            WHERE (data_inici <= ? AND data_fi >= ?)
            ORDER BY data_inici ASC
        ''', (end_date, start_date))
        month_festius = [row_to_dict(x) for x in cursor.fetchall()]

        cursor.execute('''
            SELECT id, data_inici, data_fi, tipus_abast, activitats_permeses, activitats_bloquejades, motiu
            FROM restriccions_activitats
            WHERE (data_inici <= ? AND data_fi >= ?)
            ORDER BY data_inici ASC
        ''', (end_date, start_date))
        month_restr = [row_to_dict(x) for x in cursor.fetchall()]

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
                'esFestiuPersonalitzat': estat_dia.get('es_personalitzat', False),
                'festiuId': estat_dia.get('festiu_id'),
                'festiuNom': estat_dia.get('festiu_nom'),
                'placesTotals': 0,
                'placesOcupades': 0,
                'placesLliures': 0,
                'estat': 'tancat',
                'activitatsAmbPlaces': [],
                'teRestriccio': False,
                'activitatsPermeses': [],
                'activitatsBloquejades': [a['id'] for a in activitats_list],
                'motiusRestriccio': [estat_dia['motiu']]
            }
            continue

        restr_dia = get_restriccions_dia(data_str)
        day_res = [r for r in month_reserves if r.get('data') == data_str]
        total_ocupat_dia = sum(int(r.get('places') or 1) for r in day_res)
        total_places_dia = max_cap * len(franges)
        total_lliures_dia = max(0, total_places_dia - total_ocupat_dia)

        acts_amb_places = []
        for act in activitats_list:
            act_id = act['id']
            act_nom = act['nom'].lower()
            if restr_dia['te_restriccio'] and act_id.lower() in restr_dia['bloquejades']:
                continue

            if total_lliures_dia > 0:
                if act_id in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in act_id:
                    ocupat_act = sum(int(r.get('places') or 1) for r in day_res if (r.get('activitat_id') or '').lower() in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in (r.get('activitat_id') or '').lower() or 'torn' in (r.get('activitat') or '').lower())
                else:
                    ocupat_act = sum(int(r.get('places') or 1) for r in day_res if (r.get('activitat_id') or '').lower() == act_id or (r.get('activitat') or '').lower() == act_nom)
                if ocupat_act < act['capacitatMax']:
                    acts_amb_places.append(act_id)

        if total_lliures_dia == 0:
            estat = 'complet'
        elif not acts_amb_places and total_places_dia > 0:
            estat = 'restringit'
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
            'activitatsAmbPlaces': acts_amb_places,
            'teRestriccio': restr_dia['te_restriccio'],
            'activitatsPermeses': restr_dia['permeses'] if restr_dia['te_restriccio'] else [a['id'] for a in activitats_list],
            'activitatsBloquejades': restr_dia['bloquejades'] if restr_dia['te_restriccio'] else [],
            'motiusRestriccio': restr_dia['motius']
        }

    return {
        'any': year,
        'mes': month,
        'aforamentMaximFranja': max_cap,
        'dies': days_dict,
        'activitats': activitats_list,
        'festiusPersonalitzats': month_festius,
        'restriccionsActivitats': month_restr
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
    
    stored_hash = student.get('password_hash')
    stored_pin = str(student.get('pin') or '').strip()
    input_pin = str(pin or '').strip()
    
    # Si l'alumne encara no té cap contrasenya ni PIN definit, s'inicialitza de forma segura
    if not stored_hash and not stored_pin and input_pin:
        new_hash = hash_password(input_pin)
        cursor.execute("UPDATE alumnes SET password_hash = ?, pin = ? WHERE id = ?", (new_hash, input_pin, student['id']))
        student['password_hash'] = new_hash
        student['pin'] = input_pin
        return student, None
        
    is_valid = False
    # Si stored_pin existeix i el hash no coincideix amb stored_pin, vol dir que s'ha actualitzat la columna pin directament
    if stored_hash and stored_pin and not verify_password(stored_pin, stored_hash):
        stored_hash = None

    if stored_hash:
        is_valid = verify_password(input_pin, stored_hash)
    elif stored_pin:
        is_valid = (input_pin == stored_pin)
        if is_valid:
            # Migració automàtica i silenciosa al hash PBKDF2
            new_hash = hash_password(input_pin)
            cursor.execute("UPDATE alumnes SET password_hash = ? WHERE id = ?", (new_hash, student['id']))
            student['password_hash'] = new_hash
            
    if not is_valid:
        return None, "Contrasenya (PIN) incorrecta. Pots fer servir 'He oblidat la contrasenya' per restablir-la per WhatsApp."
        
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

# ==============================================================================
# GESTIÓ D'ARTICLES, VALS REGAL I PASSAL·LELA SQUARE (CATÀLEG AMB HORES TANCADES)
# ==============================================================================

def generar_codi_val_regal():
    """Genera un codi únic i distingible per a Vals Regal: ex. REGAL-9B2F-48X2"""
    import random
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' # Sense caràcters confusos (0, O, 1, I)
    bloc1 = ''.join(random.choices(chars, k=4))
    bloc2 = ''.join(random.choices(chars, k=4))
    return f"REGAL-{bloc1}-{bloc2}"

def get_articles_catalog(include_inactive=False):
    """Retorna els articles del catàleg oficial amb hores i preus tancats."""
    with get_db() as conn:
        cursor = conn.cursor()
        if include_inactive:
            cursor.execute('SELECT * FROM articles ORDER BY ordre ASC, created_at ASC')
        else:
            cursor.execute('SELECT * FROM articles WHERE actiu = 1 ORDER BY ordre ASC, created_at ASC')
        return [row_to_dict(r) for r in cursor.fetchall()]

def get_val_regal_db(codi):
    """Cerca un val regal pel seu codi exacte o normalitzat."""
    if not codi:
        return None
    clean_codi = str(codi).strip().upper()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM vals_regal WHERE UPPER(TRIM(codi)) = ?', (clean_codi,))
        r = cursor.fetchone()
        return row_to_dict(r) if r else None

def crear_val_regal_db(titol_experiencia, hores, activitat_id, nom_destinatari,
                       nom_comprador='', email_comprador='', telefon_comprador='', email_destinatari='',
                       missatge='', preu_pagat=0.0, metode_pagament='manual',
                       transaccio_id='', article_id=None, dies_validesa=180):
    """Crea un nou val regal amb codi únic i data de caducitat a 6 mesos (180 dies) per defecte."""
    codi = generar_codi_val_regal()
    now_dt = get_now()
    data_creacio = now_dt.strftime('%Y-%m-%d %H:%M:%S')
    data_caducitat = (now_dt + timedelta(days=dies_validesa)).strftime('%Y-%m-%d')
    
    with get_db() as conn:
        cursor = conn.cursor()
        # Verificar que el codi no existeixi
        while True:
            cursor.execute('SELECT codi FROM vals_regal WHERE codi = ?', (codi,))
            if not cursor.fetchone():
                break
            codi = generar_codi_val_regal()
        
        cursor.execute('''
            INSERT INTO vals_regal (
                codi, article_id, titol_experiencia, hores, activitat_id,
                nom_comprador, email_comprador, telefon_comprador, nom_destinatari, email_destinatari,
                missatge, preu_pagat, data_creacio, data_caducitat, estat,
                metode_pagament, transaccio_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'actiu', ?, ?)
        ''', (
            codi, article_id, titol_experiencia, float(hores or 4.0), activitat_id or 'torn',
            nom_comprador.strip(), email_comprador.strip(), telefon_comprador.strip(), nom_destinatari.strip(), email_destinatari.strip(),
            missatge.strip(), float(preu_pagat or 0.0), data_creacio, data_caducitat,
            metode_pagament, transaccio_id
        ))
        conn.commit()
    
    return get_val_regal_db(codi)

def bescanviar_val_regal_db(codi, reserva_id, alumne_id=None):
    """Canvia l'estat d'un val regal a 'canviat' associant-lo a una reserva."""
    clean_codi = str(codi).strip().upper()
    val = get_val_regal_db(clean_codi)
    if not val:
        return {'ok': False, 'error': "Val regal no trobat"}
    if val['estat'] != 'actiu':
        return {'ok': False, 'error': f"Aquest val no està disponible (Estat actual: {val['estat']})"}
    
    today_str = get_now().strftime('%Y-%m-%d')
    if val.get('data_caducitat') and val['data_caducitat'] < today_str:
        return {'ok': False, 'error': f"Aquest val regal va caducar el {val['data_caducitat']}"}
    
    now_str = get_now().strftime('%Y-%m-%d %H:%M:%S')
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE vals_regal
            SET estat = 'canviat', data_canvi = ?, reserva_id = ?, alumne_id = ?
            WHERE UPPER(TRIM(codi)) = ?
        ''', (now_str, reserva_id, alumne_id, clean_codi))

        # Si el val s'associa a un alumne, se li sumen automàticament les hores al seu compte!
        if alumne_id and float(val.get('hores', 0) or 0) > 0:
            hores_val = float(val['hores'])
            segons_val = int(hores_val * 3600)
            pack_id = f"PK-VAL-{clean_codi}"
            cursor.execute("SELECT id FROM paquets_hores WHERE id = ?", (pack_id,))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'val_regal', ?)
                """, (pack_id, alumne_id, now_str, hores_val, segons_val, f"Val Regal {clean_codi} ({val.get('titol_experiencia', 'Hores')})", val.get('preu_pagat', 0), f"Val bescanviat {clean_codi}"))

        conn.commit()
    
    return {'ok': True, 'message': 'Val bescanviat correctament i hores sumades a l\'alumne'}

def generar_targeta_val_regal_html(val):
    """Genera una pàgina HTML imprimible en alta resolució (PDF) pel val regal."""
    codi = val.get('codi', '')
    titol = val.get('titol_experiencia', 'Experiència de Ceràmica')
    hores = val.get('hores', 2.0)
    destinatari = val.get('nom_destinatari', 'Algú especial')
    comprador = val.get('nom_comprador', '')
    missatge = val.get('missatge', '')
    caducitat = val.get('data_caducitat', '')
    
    de_part_de_html = f"<div class='from'>De part de: <strong>{comprador}</strong></div>" if comprador else ""
    missatge_html = f"<div class='message'>«{missatge}»</div>" if missatge else ""
    
    # URL de bescanvi directe
    qr_data = f"https://roigdecoure.cat/reserva.html?val={codi}"
    qr_img_url = f"https://api.qrserver.com/v1/create-qr-code/?size=180x180&data={urllib.parse.quote(qr_data)}"

    return f"""<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="UTF-8">
  <title>Val Regal - {codi} - Roig de Coure</title>
  <style>
    @page {{ size: A5 landscape; margin: 0; }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #fdfaf6;
      color: #2b2523;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}
    .voucher-card {{
      width: 210mm;
      height: 148mm;
      background: #ffffff;
      border: 3px solid #831D1D;
      border-radius: 18px;
      padding: 32px 40px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 10px 30px rgba(0,0,0,0.06);
      background-image: radial-gradient(#831D1D 0.75px, transparent 0.75px);
      background-size: 24px 24px;
      background-color: #fffdfa;
    }}
    .voucher-card::after {{
      content: '';
      position: absolute;
      top: 10px; left: 10px; right: 10px; bottom: 10px;
      border: 1px dashed rgba(131, 29, 29, 0.4);
      border-radius: 12px;
      pointer-events: none;
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #5E7E6F;
      padding-bottom: 16px;
      position: relative;
      z-index: 2;
    }}
    .brand-title {{
      font-size: 28px;
      font-weight: 800;
      color: #831D1D;
      letter-spacing: 0.5px;
    }}
    .brand-sub {{
      font-size: 13px;
      font-weight: 600;
      color: #5E7E6F;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-top: 2px;
    }}
    .badge {{
      background: #831D1D;
      color: #ffffff;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
    }}
    .content {{
      margin: 18px 0;
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: space-between;
      gap: 20px;
    }}
    .details {{
      flex: 1;
    }}
    .for {{
      font-size: 13px;
      color: #716b67;
      text-transform: uppercase;
      letter-spacing: 1px;
    }}
    .recipient {{
      font-size: 24px;
      font-weight: 800;
      color: #1a1615;
      margin: 2px 0 10px 0;
    }}
    .exp-title {{
      font-size: 18px;
      font-weight: 700;
      color: #831D1D;
      background: #fbf0ee;
      display: inline-block;
      padding: 6px 12px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 4px solid #831D1D;
    }}
    .from {{
      font-size: 13px;
      color: #554e4a;
      margin-bottom: 8px;
    }}
    .message {{
      font-style: italic;
      color: #4a433f;
      font-size: 13px;
      background: #f7f9f8;
      border-left: 3px solid #5E7E6F;
      padding: 6px 12px;
      border-radius: 4px;
      max-width: 440px;
      margin-top: 4px;
    }}
    .qr-box {{
      width: 130px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }}
    .qr-img {{
      width: 110px;
      height: 110px;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 4px;
      background: #fff;
    }}
    .qr-hint {{
      font-size: 10px;
      color: #716b67;
      margin-top: 6px;
      font-weight: 600;
    }}
    .footer {{
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-top: 1px solid #e5dfd8;
      padding-top: 12px;
      position: relative;
      z-index: 2;
    }}
    .code-box {{
      display: flex;
      flex-direction: column;
    }}
    .code-label {{
      font-size: 10px;
      text-transform: uppercase;
      color: #716b67;
      font-weight: 700;
      letter-spacing: 1px;
    }}
    .code-val {{
      font-family: monospace;
      font-size: 20px;
      font-weight: 800;
      color: #831D1D;
      letter-spacing: 2px;
    }}
    .validity {{
      font-size: 11px;
      color: #716b67;
      text-align: right;
    }}
    .instructions {{
      font-size: 11px;
      color: #5E7E6F;
      font-weight: 600;
    }}
    @media print {{
      body {{ background: transparent; padding: 0; }}
      .no-print {{ display: none; }}
      .voucher-card {{ box-shadow: none; border-width: 2px; }}
    }}
  </style>
</head>
<body>
  <div class="voucher-card">
    <div class="header">
      <div>
        <div class="brand-title">Roig de Coure</div>
        <div class="brand-sub">Taller d'Art i Ceràmica</div>
      </div>
      <div class="badge">VAL REGAL</div>
    </div>
    
    <div class="content">
      <div class="details">
        <div class="for">Especialment per a:</div>
        <div class="recipient">{destinatari}</div>
        <div class="exp-title">{titol} ({hores} hores)</div>
        {de_part_de_html}
        {missatge_html}
      </div>
      
      <div class="qr-box">
        <img class="qr-img" src="{qr_img_url}" alt="QR Reserva">
        <div class="qr-hint">Escaneja per triar dia i hora</div>
      </div>
    </div>
    
    <div class="footer">
      <div class="code-box">
        <div class="code-label">Codi de Bescanvi:</div>
        <div class="code-val">{codi}</div>
        <div class="instructions">Bescanviable directament a roigdecoure.cat/reserva.html</div>
      </div>
      <div class="validity">
        <div>Validesa: 6 mesos &bull; Fins al: <strong>{caducitat}</strong></div>
        <div>Taller Roig de Coure &bull; Olot</div>
      </div>
    </div>
  </div>
  
  <div class="no-print" style="position: fixed; bottom: 20px; right: 20px; display: flex; gap: 10px;">
    <button onclick="window.print()" style="background: #831D1D; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">🖨️ Imprimir / Desar en PDF</button>
  </div>
</body>
</html>"""

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
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token, X-Admin-PIN, Accept, Origin, X-Requested-With, *')
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token, X-Admin-PIN, Accept, Origin, X-Requested-With, *')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        params = urllib.parse.parse_qs(url.query)

        if not path.startswith('/api/'):
            # Seguretat C1: Bloqueig estricte d'accés a fitxers interns, base de dades i codi font
            forbidden_exts = ('.db', '.db-wal', '.db-shm', '.py', '.env', '.sqlite', '.sqlite3', '.yml', '.yaml', '.key', '.pem', '.crt', '.bak')
            norm_path = os.path.normpath(urllib.parse.unquote(path)).replace('\\', '/')
            if (norm_path.startswith('/data') or 
                norm_path.startswith('/.') or 
                '/.' in norm_path or
                any(norm_path.lower().endswith(ext) for ext in forbidden_exts)):
                self.send_response(403)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.end_headers()
                self.wfile.write(b"403 Forbidden: Acces denegat a recursos interns protegits.")
                return

            # Aliases per a rutes netes i compatibilitat (singular/plural, sense .html)
            clean_path = path.rstrip('/')
            query_str = ('?' + url.query) if url.query else ''
            if clean_path in ('/alumne', '/alumnes', '/alumnes.html'):
                self.path = '/alumne.html' + query_str
            elif clean_path == '/admin':
                self.path = '/admin.html' + query_str
            elif clean_path in ('/reserva', '/reserves'):
                self.path = '/reserva.html' + query_str
            elif clean_path in ('/botiga', '/botiga.html'):
                self.path = '/botiga.html' + query_str
            elif clean_path == '/carnet':
                self.path = '/carnet.html' + query_str
            elif clean_path == '/scanner':
                self.path = '/scanner.html' + query_str
            elif clean_path == '/landing':
                self.path = '/landing.html' + query_str
            elif clean_path in ('/3d', '/taller-3d', '/visita-3d'):
                self.path = '/taller-3d.html' + query_str
            elif clean_path in ('/web', '/activitats', '/torn', '/modelatge', '/pintar', '/grups', '/monografics', '/casals', '/val-regal', '/contacte', '/faq'):
                self.path = '/index.html' + query_str
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
            elif path == '/api/preus-hores':
                params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                req_h = params.get('hores', ['10'])[0]
                req_edat = params.get('edat', ['adult'])[0]
                es_inf = (req_edat == 'infant')
                h, p_hora, total, franja = calcular_preu_hores_trams(req_h, es_inf)
                self.send_json({
                    'ok': True,
                    'hores': h,
                    'edat': 'infant' if es_inf else 'adult',
                    'preu_hora': p_hora,
                    'total': total,
                    'franja': franja,
                    'min_hores': 4,
                    'trams_adult': [
                        {'de': 4, 'a': 9, 'preu_hora': 15.0, 'label': '4h a 9h: 15 €/h'},
                        {'de': 10, 'a': 19, 'preu_hora': 14.0, 'label': '10h a 19h: 14 €/h'},
                        {'de': 20, 'a': 999, 'preu_hora': 13.0, 'label': '20h o més: 13 €/h'}
                    ],
                    'trams_infant': [
                        {'de': 4, 'a': 9, 'preu_hora': 14.0, 'label': '4h a 9h: 14 €/h'},
                        {'de': 10, 'a': 19, 'preu_hora': 13.0, 'label': '10h a 19h: 13 €/h'},
                        {'de': 20, 'a': 999, 'preu_hora': 11.0, 'label': '20h o més: 11 €/h'}
                    ]
                })
                return

            elif path == '/api/admin/resum-mensual':
                mes_param = (params.get('mes', [''])[0]).strip()
                if not mes_param:
                    mes_param = get_now().strftime('%Y-%m')
                
                MESOS_CA = {
                    '01': 'Gener', '02': 'Febrer', '03': 'Març', '04': 'Abril',
                    '05': 'Maig', '06': 'Juny', '07': 'Juliol', '08': 'Agost',
                    '09': 'Setembre', '10': 'Octubre', '11': 'Novembre', '12': 'Desembre'
                }
                parts = mes_param.split('-')
                any_str = parts[0] if len(parts) > 0 else str(get_now().year)
                mes_num = parts[1] if len(parts) > 1 else str(get_now().month).zfill(2)
                mes_nom = f"{MESOS_CA.get(mes_num, mes_num)} {any_str}"

                pattern = f"{mes_param}%"
                with get_db() as conn:
                    cursor = conn.cursor()

                    # 1. Sessions presencials d'alumnes
                    cursor.execute("SELECT COUNT(*), COALESCE(SUM(durada_segons), 0) FROM sessions WHERE data LIKE ?", (pattern,))
                    row_sess = cursor.fetchone()
                    total_sessions = row_sess[0] if row_sess else 0
                    total_segons = row_sess[1] if row_sess else 0
                    total_hores_sess = round(total_segons / 3600.0, 1)

                    # 2. Reserves
                    cursor.execute("SELECT COUNT(*), COALESCE(SUM(places), 0), COALESCE(SUM(hores), 0) FROM reserves WHERE data LIKE ? AND estat NOT LIKE '%anul%'", (pattern,))
                    row_res = cursor.fetchone()
                    total_reserves = row_res[0] if row_res else 0
                    total_places = row_res[1] if row_res else 0
                    total_hores_res = row_res[2] if row_res else 0

                    # 3. Franja i activitat més demanades
                    cursor.execute("SELECT hora_inici, COUNT(*) as cnt FROM reserves WHERE data LIKE ? AND estat NOT LIKE '%anul%' GROUP BY hora_inici ORDER BY cnt DESC LIMIT 1", (pattern,))
                    row_hora = cursor.fetchone()
                    top_hora = row_hora['hora_inici'] if row_hora else '-'
                    top_hora_cnt = row_hora['cnt'] if row_hora else 0

                    cursor.execute("SELECT activitat, COUNT(*) as cnt FROM reserves WHERE data LIKE ? AND estat NOT LIKE '%anul%' GROUP BY activitat ORDER BY cnt DESC LIMIT 1", (pattern,))
                    row_act = cursor.fetchone()
                    top_act = row_act['activitat'] if row_act else '-'
                    top_act_cnt = row_act['cnt'] if row_act else 0

                    # 4. Packs d'hores venuts
                    cursor.execute("SELECT COUNT(*), COALESCE(SUM(hores), 0), COALESCE(SUM(preu), 0) FROM paquets_hores WHERE data LIKE ?", (pattern,))
                    row_pk = cursor.fetchone()
                    total_packs = row_pk[0] if row_pk else 0
                    total_hores_packs = row_pk[1] if row_pk else 0
                    total_ingresos_packs = float(row_pk[2]) if row_pk else 0.0

                    # 5. Vals regal venuts
                    cursor.execute("SELECT COUNT(*), COALESCE(SUM(hores), 0), COALESCE(SUM(preu_pagat), 0) FROM vals_regal WHERE data_creacio LIKE ?", (pattern,))
                    row_val = cursor.fetchone()
                    total_vals = row_val[0] if row_val else 0
                    total_hores_vals = row_val[1] if row_val else 0
                    total_ingresos_vals = float(row_val[2]) if row_val else 0.0

                self.send_json({
                    'ok': True,
                    'mes': mes_param,
                    'mes_nom': mes_nom,
                    'sessions': {
                        'total': total_sessions,
                        'hores': total_hores_sess
                    },
                    'reserves': {
                        'total': total_reserves,
                        'places': total_places,
                        'hores': total_hores_res
                    },
                    'demanda': {
                        'hora_top': top_hora,
                        'hora_top_cnt': top_hora_cnt,
                        'activitat_top': top_act,
                        'activitat_top_cnt': top_act_cnt
                    },
                    'vendes': {
                        'packs_total': total_packs,
                        'packs_hores': total_hores_packs,
                        'packs_ingresos': total_ingresos_packs,
                        'vals_total': total_vals,
                        'vals_hores': total_hores_vals,
                        'vals_ingresos': total_ingresos_vals,
                        'total_ingresos': total_ingresos_packs + total_ingresos_vals
                    }
                })
                return

            elif path == '/api/articles':
                include_inactive = params.get('include_inactive', ['0'])[0] in ('1', 'true')
                articles = get_articles_catalog(include_inactive=include_inactive)
                self.send_json({'ok': True, 'articles': articles})
                return

            elif path == '/api/vals-regal':
                estat_filtre = (params.get('estat', [''])[0]).strip().lower()
                cerca = (params.get('q', [''])[0]).strip().upper()
                with get_db() as conn:
                    cursor = conn.cursor()
                    query = 'SELECT * FROM vals_regal WHERE 1=1'
                    q_params = []
                    if estat_filtre:
                        query += ' AND estat = ?'
                        q_params.append(estat_filtre)
                    if cerca:
                        query += ' AND (UPPER(codi) LIKE ? OR UPPER(nom_destinatari) LIKE ? OR UPPER(nom_comprador) LIKE ?)'
                        pattern = f"%{cerca}%"
                        q_params.extend([pattern, pattern, pattern])
                    query += ' ORDER BY data_creacio DESC'
                    cursor.execute(query, q_params)
                    vals = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'vals': vals, 'total': len(vals)})
                return

            elif path.startswith('/api/vals-regal/verificar/'):
                codi = path.replace('/api/vals-regal/verificar/', '').strip()
                val = get_val_regal_db(codi)
                if not val:
                    self.send_json({
                        'ok': False,
                        'valid': False,
                        'error': f"El codi '{codi}' no s'ha trobat al sistema. Si el teu val és d'abans del 15/09/2026, si us plau passeu pel taller a actualitzar-lo i reservar hora."
                    }, 404)
                    return
                today_str = get_now().strftime('%Y-%m-%d')
                if val.get('data_caducitat') and val['data_caducitat'] < today_str:
                    self.send_json({'ok': False, 'valid': False, 'error': f"Aquest val va caducar el {val['data_caducitat']}", 'val': val}, 400)
                    return
                if val['estat'] != 'actiu':
                    self.send_json({'ok': False, 'valid': False, 'error': f"Aquest val ja ha estat utilitzat (Estat: {val['estat']})", 'val': val}, 400)
                    return
                self.send_json({
                    'ok': True,
                    'valid': True,
                    'val': {
                        'codi': val['codi'],
                        'titol_experiencia': val['titol_experiencia'],
                        'hores': val['hores'],
                        'activitat_id': val['activitat_id'],
                        'nom_destinatari': val['nom_destinatari'],
                        'data_caducitat': val['data_caducitat']
                    }
                })
                return

            elif path.startswith('/api/vals-regal/') and (path.endswith('/pdf') or path.endswith('/card')):
                parts = path.strip('/').split('/')
                codi = parts[2] if len(parts) >= 3 else ''
                val = get_val_regal_db(codi)
                if not val:
                    self.send_json({'ok': False, 'error': "Val regal no trobat"}, 404)
                    return
                html_card = generar_targeta_val_regal_html(val)
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(html_card.encode('utf-8'))
                return

            elif path.startswith('/api/vals-regal/'):
                codi = path.replace('/api/vals-regal/', '').strip().upper()
                val = get_val_regal_db(codi)
                if not val:
                    self.send_json({'ok': False, 'error': 'Val regal no trobat'}, 404)
                    return
                self.send_json({'ok': True, 'val': val})
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
                if not require_owner(self):
                    return
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
                    # Afegir estat actual i saldo a cada alumne i netejar credencials sensibles
                    for a in rows:
                        a.pop('pin', None)
                        a.pop('password_hash', None)
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

            elif path.startswith('/api/alumnes/') and path.endswith('/peces'):
                parts = path.strip('/').split('/')
                student_id = urllib.parse.unquote(parts[2]) if len(parts) > 2 else ''
                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, student_id, actiu_only=False)
                    real_id = student['id'] if student else student_id
                    cursor.execute('''
                        SELECT p.*, f.titol as fornada_titol, f.video_url as fornada_video_url, f.data as fornada_data
                        FROM peces_alumne p
                        LEFT JOIN fornades f ON p.fornada_id = f.id
                        WHERE p.student_id = ?
                        ORDER BY p.created_at DESC
                    ''', (real_id,))
                    peces = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'peces': peces})
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

                    for s in sessions:
                        dur_sec = s.get('durada_segons') or 0
                        fh = str(s.get('format_hms') or '').strip()
                        if '1899' in fh or 'GMT' in fh or len(fh) > 10:
                            s['format_hms'] = format_hms(dur_sec)

                    clean_student = dict(student) if student else {}
                    clean_student.pop('pin', None)
                    clean_student.pop('password_hash', None)

                    # Carregar peces de l'alumne
                    cursor.execute('''
                        SELECT p.*, f.titol as fornada_titol, f.video_url as fornada_video_url, f.data as fornada_data
                        FROM peces_alumne p
                        LEFT JOIN fornades f ON p.fornada_id = f.id
                        WHERE p.student_id = ?
                        ORDER BY p.created_at DESC
                    ''', (real_id,))
                    peces = [row_to_dict(r) for r in cursor.fetchall()]

                self.send_json({
                    'ok': True,
                    'alumne': clean_student,
                    'paquets': packs,
                    'sessions': sessions,
                    'reserves': reserves,
                    'sessioActiva': active_session,
                    'balanc': balance,
                    'peces': peces
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
                    for r in rows:
                        dur_sec = r.get('durada_segons') or 0
                        fh = str(r.get('format_hms') or '').strip()
                        if '1899' in fh or 'GMT' in fh or len(fh) > 10:
                            r['format_hms'] = format_hms(dur_sec)
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

            elif path == '/api/whatsapp/status':
                res = get_wa_gateway_status()
                self.send_json(res)
                return

            elif path == '/api/whatsapp/internal-auth-restore':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT valor FROM configuracio WHERE clau = 'wa_auth_bundle'")
                    row = cursor.fetchone()
                    if row and row['valor']:
                        try:
                            files_dict = json.loads(row['valor'])
                            self.send_json({'ok': True, 'files': files_dict})
                            return
                        except Exception as e:
                            self.send_json({'ok': False, 'error': str(e)}, 500)
                            return
                self.send_json({'ok': False, 'error': 'No backup found'}, 404)
                return

            elif path == '/api/whatsapp/sync':
                res = sync_whapi_inbound_messages()
                self.send_json(res, 200 if res.get('ok') else 500)
                return

            elif path == '/api/reserves':
                # Sincronitzar ràpidament missatges de WhatsApp en segon pla per tenir l'estat al dia
                threading.Thread(target=sync_whapi_inbound_messages, daemon=True).start()
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

            elif path == '/api/reserves/sync-calendar':
                res = sync_calendar_from_google()
                self.send_json(res, 200 if res.get('ok') else 400)
                return

            elif path in ('/api/reserves/activitats', '/api/activitats'):
                include_inactive = params.get('tots', ['0'])[0] in ('1', 'true', 'True')
                self.send_json({'ok': True, 'activitats': get_activitats_config(include_inactive=include_inactive)})
                return

            elif path in ('/api/activitats-info', '/api/info-activitats'):
                self.send_json({'ok': True, 'info': get_activitats_info_config()})
                return

            elif path == '/api/festius':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM dies_festius ORDER BY data_inici ASC')
                    custom_festius = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({
                    'ok': True,
                    'festius_oficials': FESTIUS_CATALUNYA,
                    'festius_personalitzats': custom_festius
                })
                return

            elif path == '/api/restriccions-activitats':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM restriccions_activitats ORDER BY data_inici ASC')
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                    for r in rows:
                        raw_p = (r.get('activitats_permeses') or '').strip()
                        if raw_p.startswith('['):
                            try:
                                r['activitats_permeses'] = json.loads(raw_p)
                            except Exception:
                                r['activitats_permeses'] = []
                        elif raw_p:
                            r['activitats_permeses'] = [x.strip() for x in raw_p.split(',') if x.strip()]
                        else:
                            r['activitats_permeses'] = []

                        raw_b = (r.get('activitats_bloquejades') or '').strip()
                        if raw_b.startswith('['):
                            try:
                                r['activitats_bloquejades'] = json.loads(raw_b)
                            except Exception:
                                r['activitats_bloquejades'] = []
                        elif raw_b:
                            r['activitats_bloquejades'] = [x.strip() for x in raw_b.split(',') if x.strip()]
                        else:
                            r['activitats_bloquejades'] = []

                self.send_json({'ok': True, 'restriccions': rows})
                return

            elif path == '/api/config':
                role = get_request_role(self)
                sensitive_keys = ('admin_pin', 'owner_password_hash', 'staff_password_hash', 'whatsapp_meta_token', 'square_access_token', 'square_webhook_signature_key', 'square_application_id', 'square_location_id', 'google_apps_script_url')
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT clau, valor FROM configuracio')
                    rows = cursor.fetchall()
                    if role == 'owner':
                        cfg = {r['clau']: r['valor'] for r in rows if r['clau'] not in ('admin_pin', 'owner_password_hash', 'staff_password_hash')}
                    else:
                        cfg = {r['clau']: r['valor'] for r in rows if r['clau'] not in sensitive_keys}
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
                    cursor.execute('SELECT * FROM dies_festius')
                    dies_festius = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM restriccions_activitats')
                    restriccions = [row_to_dict(r) for r in cursor.fetchall()]
                    cursor.execute('SELECT * FROM configuracio')
                    config = {r['clau']: r['valor'] for r in cursor.fetchall() if r['clau'] != 'admin_pin'}
                self.send_json({
                    'versio': '1.0',
                    'timestamp': get_now().strftime('%Y-%m-%dT%H:%M:%S'),
                    'alumnes': alumnes,
                    'paquets': paquets,
                    'sessions': sessions,
                    'reserves': reserves,
                    'dies_festius': dies_festius,
                    'restriccions_activitats': restriccions,
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

            elif path == '/api/fornades':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        SELECT f.*, 
                               COUNT(p.id) as total_peces,
                               SUM(CASE WHEN p.avis_recollida = 1 THEN 1 ELSE 0 END) as peces_pendents_recollir
                        FROM fornades f
                        LEFT JOIN peces_alumne p ON f.id = p.fornada_id
                        GROUP BY f.id
                        ORDER BY f.data DESC, f.created_at DESC
                    ''')
                    fornades = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'fornades': fornades})
                return

            elif path.startswith('/api/fornades/'):
                fornada_id = path.replace('/api/fornades/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM fornades WHERE id = ?', (fornada_id,))
                    f_row = cursor.fetchone()
                    if not f_row:
                        self.send_json({'ok': False, 'error': 'Fornada no trobada'}, 404)
                        return
                    fornada = row_to_dict(f_row)
                    cursor.execute('''
                        SELECT p.*, a.nom as student_nom, a.cognoms as student_cognoms
                        FROM peces_alumne p
                        JOIN alumnes a ON p.student_id = a.id
                        WHERE p.fornada_id = ?
                        ORDER BY p.updated_at DESC
                    ''', (fornada_id,))
                    peces = [row_to_dict(r) for r in cursor.fetchall()]
                    fornada['peces'] = peces
                self.send_json({'ok': True, 'fornada': fornada})
                return

            elif path == '/api/peces':
                estat_filtre = params.get('estat', [None])[0]
                recollida_filtre = params.get('avis_recollida', [None])[0]
                with get_db() as conn:
                    cursor = conn.cursor()
                    sql = '''
                        SELECT p.*, a.nom as student_nom, a.cognoms as student_cognoms, a.telefon as student_telefon,
                               f.titol as fornada_titol, f.video_url as fornada_video_url, f.data as fornada_data
                        FROM peces_alumne p
                        JOIN alumnes a ON p.student_id = a.id
                        LEFT JOIN fornades f ON p.fornada_id = f.id
                        WHERE 1=1
                    '''
                    q_params = []
                    if estat_filtre:
                        sql += ' AND p.estat = ?'
                        q_params.append(estat_filtre)
                    if recollida_filtre is not None:
                        sql += ' AND p.avis_recollida = ?'
                        q_params.append(int(recollida_filtre))
                    sql += ' ORDER BY p.avis_recollida DESC, p.updated_at DESC'
                    cursor.execute(sql, tuple(q_params))
                    peces = [row_to_dict(r) for r in cursor.fetchall()]
                self.send_json({'ok': True, 'peces': peces})
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
        self._post_data_raw = post_data
        data = {}
        if post_data:
            try:
                data = json.loads(post_data)
            except Exception:
                data = {}

        try:
            if path == '/api/n8n/trigger':
                event_name = data.get('event', 'manual_notification')
                payload = data.get('payload') or data
                trigger_n8n_event_async(event_name, payload)
                self.send_json({'ok': True, 'message': f'Esdeveniment {event_name} enviat a n8n Cloud!'})
                return

            elif path == '/api/admin/auth':

                pin = str(data.get('pin', '') or data.get('password', '')).strip()
                valid, role, token = verify_admin_credentials(pin)
                if valid:
                    role_label = 'Propietari' if role == 'owner' else 'Treballador (Equip)'
                    self.send_json({
                        'ok': True,
                        'token': token,
                        'role': role,
                        'message': f"Sessió iniciada correctament com a {role_label}."
                    })
                else:
                    self.send_json({'ok': False, 'error': 'Contrasenya o PIN incorrecte.'}, 401)
                return

            elif path == '/api/admin/change-credentials':
                role = get_request_role(self, data)
                current_pwd = str(data.get('current_password', '')).strip()
                owner_pwd = str(data.get('owner_password', '')).strip()
                staff_pwd = str(data.get('staff_password', '')).strip()

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT clau, valor FROM configuracio WHERE clau IN ('owner_password_hash', 'admin_pin')")
                    rows = {r['clau']: r['valor'] for r in cursor.fetchall()}
                    owner_hash = rows.get('owner_password_hash')
                    legacy_pin = rows.get('admin_pin')

                # Verificar autorització de Propietari
                is_authorized = False
                if role == 'owner':
                    is_authorized = True
                elif current_pwd:
                    if (owner_hash and verify_password(current_pwd, owner_hash)) or (legacy_pin and current_pwd == legacy_pin.strip()):
                        is_authorized = True

                if not is_authorized:
                    self.send_json({'ok': False, 'error': 'Cal indicar la contrasenya actual de Propietari per fer canvis de seguretat.'}, 403)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    if owner_pwd:
                        if len(owner_pwd) < 4:
                            self.send_json({'ok': False, 'error': 'La contrasenya de Propietari ha de tenir un mínim de 4 caràcters.'}, 400)
                            return
                        new_owner_hash = hash_password(owner_pwd)
                        cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('owner_password_hash', ?)", (new_owner_hash,))
                        cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('admin_pin', ?)", (owner_pwd,))

                    if staff_pwd:
                        if len(staff_pwd) < 4:
                            self.send_json({'ok': False, 'error': 'La contrasenya de Treballador ha de tenir un mínim de 4 caràcters.'}, 400)
                            return
                        new_staff_hash = hash_password(staff_pwd)
                        cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('staff_password_hash', ?)", (new_staff_hash,))

                    conn.commit()

                self.send_json({'ok': True, 'message': 'Credencials de seguretat actualitzades correctament.'})
                return

            # ==================================================================
            elif path == '/api/articles':
                art_id = (data.get('id') or '').strip()
                nom = (data.get('nom') or '').strip()
                descripcio = (data.get('descripcio') or '').strip()
                preu = float(data.get('preu') or 0.0)
                hores = float(data.get('hores') or 2.0)
                activitat_id = (data.get('activitat_id') or 'torn').strip().lower()
                edat = (data.get('edat') or 'adult').strip().lower()
                if edat not in ('adult', 'infant', 'tots'):
                    edat = 'adult'
                es_val_regal = 1 if data.get('es_val_regal', 1) else 0
                actiu = 1 if data.get('actiu', 1) else 0
                ordre = int(data.get('ordre') or 0)
                icona = (data.get('icona') or '').strip()

                if not nom or preu <= 0:
                    self.send_json({'ok': False, 'error': 'Cal indicar un nom i un preu superior a 0€'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    if not art_id:
                        art_id = f"art_{int(get_now().timestamp())}_{re.sub(r'[^a-z0-9]', '', nom.lower())[:10]}"
                        cursor.execute('''
                            INSERT INTO articles (id, nom, descripcio, preu, hores, activitat_id, edat, es_val_regal, actiu, ordre, icona)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (art_id, nom, descripcio, preu, hores, activitat_id, edat, es_val_regal, actiu, ordre, icona))
                    else:
                        cursor.execute('''
                            INSERT OR REPLACE INTO articles (id, nom, descripcio, preu, hores, activitat_id, edat, es_val_regal, actiu, ordre, icona)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (art_id, nom, descripcio, preu, hores, activitat_id, edat, es_val_regal, actiu, ordre, icona))
                    conn.commit()

                self.send_json({'ok': True, 'id': art_id, 'message': 'Article desat correctament'})
                return

            elif path == '/api/articles/toggle-actiu':
                art_id = (data.get('id') or '').strip()
                if not art_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'ID de l'article"}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('UPDATE articles SET actiu = CASE WHEN actiu = 1 THEN 0 ELSE 1 END WHERE id = ?', (art_id,))
                    conn.commit()
                    cursor.execute('SELECT actiu FROM articles WHERE id = ?', (art_id,))
                    row = cursor.fetchone()
                    new_state = row['actiu'] if row else 1
                self.send_json({'ok': True, 'actiu': new_state, 'message': f"Estat actualitzat a: {'Actiu' if new_state else 'Ocult'}"})
                return

            elif path == '/api/vals-regal/crear-manual':
                titol = (data.get('titol') or data.get('titol_experiencia') or 'Taller de Ceràmica').strip()
                hores = float(data.get('hores') or 2.0)
                activitat_id = (data.get('activitat_id') or 'torn').strip()
                nom_destinatari = (data.get('nom_destinatari') or data.get('destinatari') or '').strip()
                nom_comprador = (data.get('nom_comprador') or data.get('comprador') or '').strip()
                email_comprador = (data.get('email_comprador') or '').strip()
                telefon_comprador = (data.get('telefon_comprador') or data.get('telefon') or '').strip()
                email_destinatari = (data.get('email_destinatari') or '').strip()
                missatge = (data.get('missatge') or '').strip()
                preu = float(data.get('preu') or 0.0)
                metode = (data.get('metode_pagament') or 'efectiu_tpv_taller').strip()
                article_id = (data.get('article_id') or None)
                dies = int(data.get('dies_validesa') or 180)

                if not nom_destinatari:
                    self.send_json({'ok': False, 'error': 'Cal indicar el nom de la persona que rebrà el regal'}, 400)
                    return

                nou_val = crear_val_regal_db(
                    titol_experiencia=titol,
                    hores=hores,
                    activitat_id=activitat_id,
                    nom_destinatari=nom_destinatari,
                    nom_comprador=nom_comprador,
                    email_comprador=email_comprador,
                    telefon_comprador=telefon_comprador,
                    email_destinatari=email_destinatari,
                    missatge=missatge,
                    preu_pagat=preu,
                    metode_pagament=metode,
                    article_id=article_id,
                    dies_validesa=dies
                )

                self.send_json({
                    'ok': True,
                    'val': nou_val,
                    'codi': nou_val['codi'],
                    'message': f"Val regal creat amb èxit! Codi generat: {nou_val['codi']}"
                })
                return

            elif path == '/api/vals-regal/anullar':
                codi = (data.get('codi') or '').strip().upper()
                if not codi:
                    self.send_json({'ok': False, 'error': 'Cal indicar el codi del val regal'}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("UPDATE vals_regal SET estat = 'anul·lat' WHERE UPPER(TRIM(codi)) = ? AND estat != 'canviat'", (codi,))
                    if cursor.rowcount == 0:
                        self.send_json({'ok': False, 'error': 'No s\'ha pogut anul·lar el val (potser ja està canviat o no existeix)'}, 400)
                        return
                    conn.commit()
                self.send_json({'ok': True, 'message': f"Val regal {codi} anul·lat correctament"})
                return

            elif path == '/api/vals-regal/bescanviar':
                codi = (data.get('codi') or '').strip().upper()
                if not codi:
                    self.send_json({'ok': False, 'error': 'Cal indicar el codi del val regal'}, 400)
                    return
                res = bescanviar_val_regal_db(codi, reserva_id=data.get('reserva_id', 'MANUAL-ADMIN'), alumne_id=data.get('alumne_id'))
                if not res.get('ok'):
                    self.send_json(res, 400)
                    return
                self.send_json({'ok': True, 'message': f"Val regal {codi} bescanviat correctament!", 'val': res.get('val')})
                return

            elif path == '/api/vals-regal/editar':
                codi = (data.get('codi') or '').strip().upper()
                nom_destinatari = (data.get('nom_destinatari') or '').strip()
                nom_comprador = (data.get('nom_comprador') or '').strip()
                email_comprador = (data.get('email_comprador') or '').strip()
                telefon_comprador = (data.get('telefon_comprador') or data.get('telefon') or '').strip()
                missatge = (data.get('missatge') or '').strip()
                titol = (data.get('titol_experiencia') or '').strip()
                hores = float(data.get('hores') or 2.0)
                preu = float(data.get('preu_pagat') or 0.0)
                data_caducitat = (data.get('data_caducitat') or '').strip()
                estat = (data.get('estat') or 'actiu').strip().lower()

                if not codi or not nom_destinatari:
                    self.send_json({'ok': False, 'error': 'Cal indicar el codi i el nom de la persona destinatària'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        UPDATE vals_regal
                        SET nom_destinatari = ?, nom_comprador = ?, email_comprador = ?, telefon_comprador = ?,
                            missatge = ?, titol_experiencia = ?, hores = ?,
                            preu_pagat = ?, data_caducitat = ?, estat = ?
                        WHERE UPPER(TRIM(codi)) = ?
                    ''', (nom_destinatari, nom_comprador, email_comprador, telefon_comprador, missatge, titol, hores, preu, data_caducitat, estat, codi))
                    if cursor.rowcount == 0:
                        self.send_json({'ok': False, 'error': 'Val regal no trobat a la base de dades'}, 404)
                        return
                    conn.commit()

                val_actualitzat = get_val_regal_db(codi)
                self.send_json({'ok': True, 'val': val_actualitzat, 'message': 'Val regal actualitzat correctament'})
                return

            elif path == '/api/demo/seed':
                # Inicialitza / restaura dades demo segures per a proves
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT OR REPLACE INTO vals_regal 
                        (codi, article_id, titol_experiencia, hores, activitat_id, nom_destinatari, nom_comprador, email_comprador, missatge, preu_pagat, data_creacio, data_caducitat, estat, metode_pagament, transaccio_id, notes)
                        VALUES ('REGAL-DEMO-2026', 'art_torn_adult', 'Taller de torn (Adult)', 2.0, 'torn', 'Laura Soler (Demo)', 'Marc Amic', 'demo@exemple.cat', 'Perquè gaudeixis de la ceràmica!', 50.0, '2026-09-15', '2027-03-15', 'actiu', 'demo_sandbox', 'DEMO-TX-1', 'Val de prova demo')
                    """)
                    cursor.execute("""
                        INSERT OR REPLACE INTO vals_regal 
                        (codi, article_id, titol_experiencia, hores, activitat_id, nom_destinatari, nom_comprador, email_comprador, missatge, preu_pagat, data_creacio, data_caducitat, estat, data_canvi, reserva_id, metode_pagament, transaccio_id, notes)
                        VALUES ('REGAL-UTILITZAT-2026', 'art_modelatge_adult', 'Taller de modelatge (Adult)', 2.0, 'modelatge', 'Jordi Mas (Demo)', 'Anna Casals', 'anna@exemple.cat', 'Felicitats!', 45.0, '2026-09-01', '2027-03-01', 'canviat', '2026-09-10T11:00:00', 'RES-DEMO-PREV', 'demo_sandbox', 'DEMO-TX-2', 'Val canviat de prova')
                    """)
                    cursor.execute("""
                        INSERT OR REPLACE INTO alumnes
                        (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu)
                        VALUES ('ALU-DEMO-01', 'Laura', 'Soler Mas', '+34683633880', 'laura.demo@exemple.cat', '1234', '2026-09-01', 'Alumne de demostració (Saldo 8h)', 1)
                    """)
                    conn.commit()

                self.send_json({
                    'ok': True,
                    'message': 'Dades de demostració inicialitzades correctament!',
                    'val_actiu': 'REGAL-DEMO-2026',
                    'val_utilitzat': 'REGAL-UTILITZAT-2026',
                    'alumne_demo': 'ALU-DEMO-01'
                })
                return
            elif path == '/api/admin/square/test':
                sq_token = (data.get('token') or '').strip()
                sq_loc_id = (data.get('location_id') or '').strip()
                sq_env = (data.get('environment') or 'sandbox').strip()

                if not sq_token or not sq_loc_id:
                    self.send_json({'ok': False, 'error': 'Cal indicar el token i el location ID'}, 400)
                    return

                api_base = "https://connect.squareupsandbox.com" if sq_env == 'sandbox' else "https://connect.squareup.com"
                url = f"{api_base}/v2/locations/{sq_loc_id}"
                req = urllib.request.Request(
                    url,
                    headers={
                        "Square-Version": "2024-01-18",
                        "Authorization": f"Bearer {sq_token}",
                        "Content-Type": "application/json"
                    },
                    method="GET"
                )
                try:
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        res_data = json.loads(resp.read().decode('utf-8'))
                        loc = res_data.get('location', {})
                        self.send_json({
                            'ok': True,
                            'location_name': loc.get('name'),
                            'currency': loc.get('currency'),
                            'business_name': loc.get('business_name'),
                            'message': f"Connectat correctament a Square ({loc.get('name', 'Taller')})!"
                        })
                        return
                except urllib.error.HTTPError as he:
                    try:
                        err_body = json.loads(he.read().decode('utf-8'))
                        msg = err_body.get('errors', [{}])[0].get('detail', str(he))
                    except Exception:
                        msg = str(he)
                    self.send_json({'ok': False, 'error': f"Error de Square ({he.code}): {msg}"}, 400)
                    return
                except Exception as e:
                    self.send_json({'ok': False, 'error': f"No s'ha pogut connectar amb Square: {str(e)}"}, 500)
                    return

            elif path == '/api/checkout/paga-senyal':
                res_id = (data.get('reserva_id') or '').strip()
                places = int(data.get('places') or 4)
                nom = (data.get('nom') or '').strip()
                tel = (data.get('telefon') or '').strip()
                custom_import = data.get('import') or data.get('paga_senyal')

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM reserves WHERE id = ?', (res_id,))
                    r_row = cursor.fetchone()
                    if r_row:
                        places = int(r_row['places'] or places)
                        nom = r_row['student_nom'] or nom
                        tel = r_row['telefon'] or tel
                        if not custom_import and r_row['paga_senyal'] is not None and float(r_row['paga_senyal']) > 0:
                            custom_import = float(r_row['paga_senyal'])
                    cursor.execute('SELECT clau, valor FROM configuracio WHERE clau LIKE "square_%"')
                    sq_cfg = {r['clau']: r['valor'] for r in cursor.fetchall()}

                sq_token = (sq_cfg.get('square_access_token') or '').strip()
                sq_loc_id = (sq_cfg.get('square_location_id') or '').strip()
                sq_env = (sq_cfg.get('square_environment') or 'sandbox').strip()

                if custom_import is not None:
                    try:
                        total_dep = float(custom_import)
                    except Exception:
                        total_dep = places * 10.0
                else:
                    total_dep = places * 10.0

                preu_cents = int(round(total_dep * 100))

                host_url = self.headers.get('Host', 'localhost:8080')
                scheme = 'https' if not host_url.startswith('localhost') and not host_url.startswith('127.0.0.1') else 'http'
                base_domain = f"{scheme}://{host_url}"

                if not sq_token or not sq_loc_id:
                    self.send_json({
                        'ok': False,
                        'error': "No s'ha pogut generar l'enllaç de pagament perquè la passarel·la Square no té configurat el token d'accés o la ubicació al sistema del taller."
                    }, 400)
                    return

                api_base = "https://connect.squareupsandbox.com" if sq_env == 'sandbox' else "https://connect.squareup.com"
                sq_url = f"{api_base}/v2/online-checkout/payment-links"

                dep_prefix = res_id if res_id else 'direct'
                order_payload = {
                    "idempotency_key": f"dep_{dep_prefix}_{int(get_now().timestamp())}_{secrets.token_hex(3)}",
                    "order": {
                        "location_id": sq_loc_id,
                        "line_items": [
                            {
                                "name": f"Paga i Senyal Reserva - {nom or 'Grup'} ({places} places)",
                                "quantity": "1",
                                "base_price_money": {
                                    "amount": preu_cents,
                                    "currency": "EUR"
                                }
                            }
                        ],
                        "metadata": {
                            "tipus_compra": "paga_senyal",
                            "reserva_id": res_id if res_id else "direct"
                        }
                    },
                    "checkout_options": {
                        "redirect_url": f"{base_domain}/reserva.html?reserva_confirmada={res_id}" if res_id else f"{base_domain}/reserva.html"
                    }
                }

                req_sq = urllib.request.Request(
                    sq_url,
                    data=json.dumps(order_payload).encode('utf-8'),
                    headers={
                        "Square-Version": "2024-01-18",
                        "Authorization": f"Bearer {sq_token}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )
                try:
                    with urllib.request.urlopen(req_sq, timeout=15) as resp_sq:
                        sq_res_data = json.loads(resp_sq.read().decode('utf-8'))
                        payment_link = sq_res_data.get('payment_link', {})
                        checkout_url = payment_link.get('url') or payment_link.get('long_url')
                        if res_id and checkout_url:
                            try:
                                with get_db() as conn_up:
                                    conn_up.cursor().execute("UPDATE reserves SET paga_senyal_link = ?, paga_senyal = ? WHERE id = ?", (checkout_url, total_dep, res_id))
                                    conn_up.commit()
                            except Exception as e_up:
                                print(f"[Paga Senyal] Error desant link a reserves: {e_up}")

                        self.send_json({
                            'ok': True,
                            'mode': 'square',
                            'checkout_url': checkout_url,
                            'import': total_dep,
                            'places': places,
                            'nom': nom,
                            'telefon': tel
                        })
                        return
                except urllib.error.HTTPError as sq_err:
                    err_body = sq_err.read().decode('utf-8', errors='ignore')
                    print("[Square HTTPError Body]:", err_body)
                    self.send_json({'ok': False, 'error': f"Error connectant amb Square: {err_body}"}, 500)
                    return
                except Exception as sq_err:
                    self.send_json({'ok': False, 'error': f"Error connectant amb Square: {str(sq_err)}"}, 500)
                    return
            elif path == '/api/checkout/create-session':
                # Creació de sessió de cobrament a Square (o simulada en proves locals)
                article_id = (data.get('article_id') or '').strip()
                tipus_compra = (data.get('tipus_compra') or 'val_regal').strip() # 'val_regal' o 'alumne'
                nom_destinatari = (data.get('nom_destinatari') or '').strip()
                nom_comprador = (data.get('nom_comprador') or '').strip()
                email_comprador = (data.get('email_comprador') or '').strip()
                email_destinatari = (data.get('email_destinatari') or '').strip()
                missatge = (data.get('missatge') or '').strip()
                student_id = (data.get('student_id') or '').strip()

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM articles WHERE id = ?', (article_id,))
                    art_row = cursor.fetchone()
                    if not art_row:
                        self.send_json({'ok': False, 'error': "Article no trobat al catàleg"}, 404)
                        return
                    article = row_to_dict(art_row)

                    # Obtenir configuració de Square
                    cursor.execute('SELECT clau, valor FROM configuracio WHERE clau LIKE "square_%"')
                    sq_cfg = {r['clau']: r['valor'] for r in cursor.fetchall()}

                sq_token = (sq_cfg.get('square_access_token') or '').strip()
                sq_loc_id = (sq_cfg.get('square_location_id') or '').strip()
                sq_env = (sq_cfg.get('square_environment') or 'sandbox').strip()

                # Càlcul dinàmic d'hores si es compren hores (amb trams de preu)
                req_hores = data.get('hores')
                is_hores = ('hores' in article['id'].lower() or 'hores' in article['nom'].lower() or req_hores is not None)
                if is_hores:
                    if req_hores is not None and int(req_hores) < 4:
                        self.send_json({'ok': False, 'error': 'La compra mínima de la bossa d\'hores és de 4 hores.'}, status=400)
                        return
                    es_inf = (article.get('edat') == 'infant' or data.get('edat') == 'infant')
                    h_num, p_hora, total_import, _ = calcular_preu_hores_trams(req_hores or article.get('hores', 4), es_inf)
                    article['hores'] = float(h_num)
                    article['preu'] = total_import
                    edat_label = 'Menor de 12 anys' if es_inf else 'Adult'
                    nom_article = f"Bossa de {h_num} hores ({edat_label} a {int(p_hora)} €/h)"
                else:
                    nom_article = article['nom']

                preu_cents = int(round(float(article['preu']) * 100))
                host_url = self.headers.get('Host', 'localhost:8080')
                scheme = 'https' if not host_url.startswith('localhost') and not host_url.startswith('127.0.0.1') else 'http'
                base_domain = f"{scheme}://{host_url}"

                # Si no hi ha claus de Square configurades, mode demo/proves immediat
                if not sq_token or not sq_loc_id:
                    # En entorn de desenvolupament sense credencials, creem directament el val per testejar el flux
                    if tipus_compra == 'val_regal':
                        nou_val = crear_val_regal_db(
                            titol_experiencia=nom_article,
                            hores=article['hores'],
                            activitat_id=article['activitat_id'],
                            nom_destinatari=nom_destinatari or nom_comprador or 'Destinatari Regal',
                            nom_comprador=nom_comprador,
                            email_comprador=email_comprador,
                            email_destinatari=email_destinatari,
                            missatge=missatge,
                            preu_pagat=article['preu'],
                            metode_pagament='demo_sense_tpv',
                            transaccio_id=f"DEMO-{int(get_now().timestamp())}",
                            article_id=article['id']
                        )
                        redirect_url = f"{base_domain}/reserva.html?val={nou_val['codi']}&compra_exit=1"
                        self.send_json({
                            'ok': True,
                            'mode': 'demo_direct',
                            'checkout_url': redirect_url,
                            'codi_val': nou_val['codi'],
                            'message': 'Simulació de compra completada! S\'ha generat el val regal.'
                        })
                        return
                    else:
                        self.send_json({
                            'ok': True,
                            'mode': 'demo_direct',
                            'checkout_url': f"{base_domain}/alumne.html?recarga_ok=1",
                            'message': 'Simulació de recàrrega d\'hores completada.'
                        })
                        return

                # Crida a l'API oficial de Square Payments Links
                api_base = "https://connect.squareupsandbox.com" if sq_env == 'sandbox' else "https://connect.squareup.com"
                sq_url = f"{api_base}/v2/online-checkout/payment-links"
                
                order_payload = {
                    "idempotency_key": f"pay_{int(get_now().timestamp())}_{os.urandom(4).hex()}",
                    "order": {
                        "location_id": sq_loc_id,
                        "line_items": [
                            {
                                "name": nom_article,
                                "quantity": "1",
                                "base_price_money": {
                                    "amount": preu_cents,
                                    "currency": "EUR"
                                }
                            }
                        ],
                        "metadata": {k: str(v).strip() for k, v in {
                            "article_id": article_id,
                            "tipus_compra": tipus_compra,
                            "nom_destinatari": nom_destinatari,
                            "nom_comprador": nom_comprador,
                            "email_comprador": email_comprador,
                            "email_destinatari": email_destinatari,
                            "missatge": missatge,
                            "student_id": student_id,
                            "hores": str(article['hores']),
                            "preu": str(article['preu']),
                            "titol": nom_article
                        }.items() if v and str(v).strip()}
                    },
                    "checkout_options": {
                        "redirect_url": f"{base_domain}/reserva.html?pagament_square=completat"
                    }
                }

                req_sq = urllib.request.Request(
                    sq_url,
                    data=json.dumps(order_payload).encode('utf-8'),
                    headers={
                        "Square-Version": "2024-01-18",
                        "Authorization": f"Bearer {sq_token}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )

                try:
                    with urllib.request.urlopen(req_sq, timeout=15) as resp_sq:
                        sq_res_data = json.loads(resp_sq.read().decode('utf-8'))
                        payment_link = sq_res_data.get('payment_link', {})
                        checkout_url = payment_link.get('url') or payment_link.get('long_url')
                        self.send_json({
                            'ok': True,
                            'mode': 'square',
                            'checkout_url': checkout_url,
                            'order_id': payment_link.get('order_id')
                        })
                        return
                except urllib.error.HTTPError as sq_http_err:
                    try:
                        err_body = sq_http_err.read().decode('utf-8')
                    except Exception:
                        err_body = str(sq_http_err)
                    self.send_json({'ok': False, 'error': f"Error connectant amb Square: {err_body}"}, 500)
                    return
                except Exception as sq_err:
                    self.send_json({'ok': False, 'error': f"Error connectant amb Square: {str(sq_err)}"}, 500)
                    return

            elif path == '/api/webhooks/square':
                # Validació criptogràfica de la signatura de Square (C3)
                sq_sig = self.headers.get('x-square-hmacsha256-signature') or self.headers.get('X-Square-HMACSHA256-Signature')
                with get_db() as conn_sig:
                    c_sig = conn_sig.cursor()
                    c_sig.execute("SELECT valor FROM configuracio WHERE clau = 'square_webhook_signature_key'")
                    row_sig = c_sig.fetchone()
                    sig_key = (row_sig['valor'] if row_sig else '') or ''

                if not sig_key:
                    self.send_json({'ok': False, 'error': 'Square webhook signature key no està configurada al servidor'}, 401)
                    return

                if not sq_sig:
                    self.send_json({'ok': False, 'error': 'Manca signatura x-square-hmacsha256-signature'}, 401)
                    return

                host = self.headers.get('Host', '')
                proto = self.headers.get('X-Forwarded-Proto', 'https')
                webhook_url = f"{proto}://{host}{self.path}"
                body_to_sign = webhook_url + getattr(self, '_post_data_raw', '')
                mac = hmac.new(sig_key.encode('utf-8'), body_to_sign.encode('utf-8'), hashlib.sha256)
                expected_sig = base64.b64encode(mac.digest()).decode('utf-8')
                if not secrets.compare_digest(expected_sig, sq_sig):
                    self.send_json({'ok': False, 'error': 'Signatura de webhook invàlida'}, 401)
                    return

                # Webhook per rebre confirmacions de cobrament de Square
                event_type = data.get('type')
                if event_type in ('payment.updated', 'order.updated'):
                    payment_data = data.get('data', {}).get('object', {}).get('payment', {})
                    if payment_data.get('status') == 'COMPLETED':
                        order_id = payment_data.get('order_id')
                        meta = payment_data.get('metadata') or {}
                        tipus_compra = meta.get('tipus_compra', 'val_regal')
                        article_id = meta.get('article_id')
                        
                        if tipus_compra == 'paga_senyal':
                            res_id = meta.get('reserva_id')
                            if res_id:
                                with get_db() as conn_dep:
                                    conn_dep.cursor().execute("UPDATE reserves SET estat = 'confirmada', notes = notes || ' [PAGA I SENYAL PAGADA PER SQUARE]' WHERE id = ?", (res_id,))
                                    conn_dep.commit()
                        elif tipus_compra == 'alumne' or meta.get('student_id'):
                            stu_id = meta.get('student_id')
                            if stu_id:
                                h_num = float(meta.get('hores') or 10.0)
                                p_num = float(meta.get('preu') or 0.0)
                                segons_num = int(h_num * 3600)
                                pk_id = f"PK-SQ-{payment_data.get('id', order_id)}"
                                with get_db() as conn_pk:
                                    c_pk = conn_pk.cursor()
                                    c_pk.execute("SELECT id FROM paquets_hores WHERE id = ?", (pk_id,))
                                    if not c_pk.fetchone():
                                        c_pk.execute("""
                                            INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament, stripe_session_id, notes)
                                            VALUES (?, ?, ?, ?, ?, ?, ?, 'square', ?, ?)
                                        """, (pk_id, stu_id, get_now().strftime('%Y-%m-%d %H:%M:%S'), h_num, segons_num, f"Adquisició {h_num}h (Square en línia)", p_num, order_id, "Cobrament completat via Square"))
                                        conn_pk.commit()
                        elif tipus_compra == 'val_regal' and article_id:
                            with get_db() as conn_w:
                                c_w = conn_w.cursor()
                                c_w.execute('SELECT * FROM articles WHERE id = ?', (article_id,))
                                art = c_w.fetchone()
                                if art:
                                    val_hores = float(meta.get('hores') or art['hores'])
                                    val_preu = float(meta.get('preu') or art['preu'])
                                    val_titol = meta.get('titol') or art['nom']
                                    crear_val_regal_db(
                                        titol_experiencia=val_titol,
                                        hores=val_hores,
                                        activitat_id=art['activitat_id'],
                                        nom_destinatari=meta.get('nom_destinatari', 'Destinatari'),
                                        nom_comprador=meta.get('nom_comprador', ''),
                                        email_comprador=meta.get('email_comprador', ''),
                                        email_destinatari=meta.get('email_destinatari', ''),
                                        missatge=meta.get('missatge', ''),
                                        preu_pagat=val_preu,
                                        metode_pagament='square',
                                        transaccio_id=payment_data.get('id', order_id),
                                        article_id=article_id
                                    )
                self.send_json({'ok': True})
                return

            elif path == '/api/admin/change-pin':
                if not require_owner(self, data):
                    return
                old_pin = str(data.get('oldPin', '')).strip()
                new_pin = str(data.get('newPin', '')).strip()
                if not verify_admin_pin(old_pin):
                    self.send_json({'ok': False, 'error': 'La contrasenya actual no és correcta'}, 401)
                    return
                if len(new_pin) < 4:
                    self.send_json({'ok': False, 'error': 'La nova contrasenya ha de tenir com a mínim 4 caràcters'}, 400)
                    return
                new_hash = hash_password(new_pin)
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('owner_password_hash', ?)", (new_hash,))
                    cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('admin_pin', ?)", (new_pin,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Contrasenya de Propietari actualitzada correctament'})
                return

            elif path == '/api/admin/backups':
                if not require_owner(self, data):
                    return
                try:
                    filename = create_manual_snapshot()
                    self.send_json({'ok': True, 'filename': filename, 'message': f'Còpia de seguretat creada: {filename}'})
                except Exception as e:
                    self.send_json({'ok': False, 'error': f'Error creant còpia: {str(e)}'}, 500)
                return

            elif path == '/api/admin/backups/restore':
                if not require_owner(self, data):
                    return
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

            elif path == '/api/alumnes/sollicitar-recuperacio':
                identifier = str(data.get('identifier', '')).strip()
                if not identifier:
                    self.send_json({'ok': False, 'error': "Indica el teu telèfon, correu electrònic o nom d'alumne."}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, identifier, actiu_only=False)
                    if not student:
                        # Cerca per telèfon si l'identificador conté dígits
                        clean_digits = re.sub(r'[^0-9]', '', identifier)
                        if len(clean_digits) >= 6:
                            cursor.execute("SELECT * FROM alumnes WHERE telefon LIKE ? OR telefon LIKE ?", (f"%{clean_digits[-9:]}%", f"%{clean_digits}%"))
                            st_row = cursor.fetchone()
                            if st_row:
                                student = row_to_dict(st_row)

                    if not student:
                        self.send_json({'ok': False, 'error': "No s'ha trobat cap alumne amb aquestes dades."}, 404)
                        return

                    tel = student.get('telefon') or ''
                    clean_tel = re.sub(r'[^0-9]', '', tel)
                    if not clean_tel or len(clean_tel) < 9:
                        self.send_json({'ok': False, 'error': "La teva fitxa d'alumne no té cap telèfon registrat per rebre el WhatsApp."}, 400)
                        return

                    # Generar codi OTP de 6 dígits
                    otp_code = str(secrets.randbelow(900000) + 100000)
                    otp_hash = hash_password(otp_code)
                    now_dt = get_now()
                    expires_dt = now_dt + timedelta(minutes=15)

                    # Inhabilitar sol·licituds anteriors
                    cursor.execute("UPDATE password_resets SET used = 1 WHERE student_id = ? AND used = 0", (student['id'],))
                    cursor.execute(
                        "INSERT INTO password_resets (student_id, otp_hash, expires_at, created_at, used) VALUES (?, ?, ?, ?, 0)",
                        (student['id'], otp_hash, expires_dt.isoformat(), now_dt.isoformat())
                    )
                    conn.commit()

                # Enviar missatge automàtic per Meta WhatsApp API
                msg_text = (
                    f"Hola {student['nom']}! 👋\n\n"
                    f"El teu codi de seguretat per recuperar la contrasenya del Taller de Ceràmica Roig de Coure és:\n\n"
                    f"👉 *{otp_code}* 👈\n\n"
                    f"Aquest codi és d'un sol ús i caduca en 15 minuts. Introdueix-lo a la pantalla per triar la teva nova contrasenya."
                )

                wa_res = send_whatsapp_direct(clean_tel, msg_text)
                if not wa_res.get('ok'):
                    # Intentar també per template
                    wa_res = send_whatsapp_meta(clean_tel, 'recuperacio_contrasenya', [student['nom'], otp_code])

                masked_phone = clean_tel
                if len(clean_tel) >= 4:
                    masked_phone = f"...{clean_tel[-4:]}"

                self.send_json({
                    'ok': True,
                    'student_id': student['id'],
                    'student_nom': student['nom'],
                    'masked_phone': masked_phone,
                    'whatsapp_sent': bool(wa_res.get('ok')),
                    'message': f"T'hem enviat un codi de seguretat de 6 dígits al teu WhatsApp acabat en {masked_phone}."
                })
                return

            elif path == '/api/alumnes/verificar-otp-i-restablir':
                student_id = str(data.get('student_id', '')).strip()
                otp = str(data.get('otp', '')).strip()
                new_password = str(data.get('new_password', '')).strip()

                if not student_id or not otp or not new_password:
                    self.send_json({'ok': False, 'error': "Cal facilitar el codi de seguretat i la nova contrasenya."}, 400)
                    return

                if len(new_password) < 4:
                    self.send_json({'ok': False, 'error': "La nova contrasenya ha de tenir com a mínim 4 caràcters."}, 400)
                    return

                now_iso = get_now().isoformat()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT id, otp_hash FROM password_resets WHERE student_id = ? AND used = 0 AND expires_at >= ? ORDER BY id DESC LIMIT 1",
                        (student_id, now_iso)
                    )
                    reset_row = cursor.fetchone()
                    if not reset_row:
                        self.send_json({'ok': False, 'error': "El codi de seguretat ha caducat o no és vàlid. Demana'n un de nou."}, 400)
                        return

                    if not verify_password(otp, reset_row['otp_hash']):
                        self.send_json({'ok': False, 'error': "Codi de seguretat incorrecte. Revisa el missatge de WhatsApp."}, 400)
                        return

                    new_hash = hash_password(new_password)
                    cursor.execute("UPDATE alumnes SET password_hash = ?, pin = ? WHERE id = ?", (new_hash, new_password, student_id))
                    cursor.execute("UPDATE password_resets SET used = 1 WHERE id = ?", (reset_row['id'],))
                    conn.commit()

                    student = find_student_by_code(cursor, student_id)

                if student:
                    try:
                        sync_to_google_sheets_async('sync_alumne', student)
                    except Exception as e:
                        print(f"Avís sync GS alumne nou hash: {e}")

                if student:
                    student = dict(student)
                    student.pop('pin', None)
                    student.pop('password_hash', None)

                self.send_json({
                    'ok': True,
                    'student': student,
                    'message': "La teva contrasenya s'ha actualitzat correctament! Ja pots entrar al portal."
                })
                return

            elif path == '/api/alumnes/recuperar-pin':
                # Per seguretat estricta, mai es retorna el PIN/contrasenya en text pla
                self.send_json({
                    'ok': False,
                    'error': "Per motius de seguretat, les contrasenyes no es mostren en pantalla. Utilitza l'opció 'Recuperar per WhatsApp' per rebre un codi de verificació segur al teu mòbil.",
                    'code': 'USE_OTP_RECOVERY'
                }, 403)
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

                    role = get_request_role(self, data)
                    is_admin = (role in ('owner', 'staff'))
                    if not is_admin:
                        if not current_pin:
                            self.send_json({'ok': False, 'error': "Cal indicar la contrasenya actual per canviar-la"}, 400)
                            return
                        is_current_valid = False
                        if student.get('password_hash'):
                            is_current_valid = verify_password(current_pin, student['password_hash'])
                        elif student.get('pin'):
                            is_current_valid = (str(student['pin']).strip() == current_pin)
                        if not is_current_valid:
                            self.send_json({'ok': False, 'error': "La contrasenya actual no és correcta"}, 401)
                            return
                    new_hash = hash_password(new_pin)
                    cursor.execute("UPDATE alumnes SET password_hash = ?, pin = ? WHERE id = ?", (new_hash, new_pin, student['id']))
                    conn.commit()
                    updated_st = find_student_by_code(cursor, student['id'])
                if updated_st:
                    try:
                        sync_to_google_sheets_async('sync_alumne', updated_st)
                    except Exception as e:
                        print(f"Avís sync GS alumne PIN: {e}")
                self.send_json({'ok': True, 'message': "Contrasenya actualitzada correctament"})
                return

            elif path == '/api/alumnes/registre':
                # Registre d'alta autonoma d'alumnes
                nom = (data.get('nom') or '').strip()
                cognoms = (data.get('cognoms') or '').strip()
                telefon = (data.get('telefon') or '').strip()
                email = (data.get('email') or '').strip()
                pin = (data.get('pin') or data.get('contrasenya') or '').strip()
                notes = (data.get('notes') or '').strip()

                if not nom:
                    self.send_json({'ok': False, 'error': 'El nom és obligatori'}, 400)
                    return
                if not telefon:
                    self.send_json({'ok': False, 'error': 'El telèfon mòbil és obligatori'}, 400)
                    return
                if not email or '@' not in email:
                    self.send_json({'ok': False, 'error': 'Cal indicar un correu electrònic vàlid'}, 400)
                    return
                if not pin or len(pin) < 4:
                    self.send_json({'ok': False, 'error': 'La contrasenya ha de tenir com a mínim 4 caràcters'}, 400)
                    return

                clean_tel = re.sub(r'[\s\-_+.]', '', telefon)

                with get_db() as conn:
                    cursor = conn.cursor()
                    # Comprovar si ja existeix un alumne actiu amb el mateix correu o telefon
                    cursor.execute('''
                        SELECT id, nom, cognoms, email, telefon FROM alumnes 
                        WHERE actiu = 1 AND (
                            (LENGTH(email) > 3 AND LOWER(TRIM(email)) = LOWER(TRIM(?)))
                            OR (LENGTH(?) >= 8 AND REPLACE(REPLACE(REPLACE(REPLACE(telefon, '+', ''), ' ', ''), '-', ''), '.', '') LIKE '%' || ?)
                        )
                        LIMIT 1
                    ''', (email, clean_tel, clean_tel[-8:] if len(clean_tel) >= 8 else clean_tel))
                    existing_student = cursor.fetchone()

                    if existing_student:
                        ex_dict = row_to_dict(existing_student)
                        ex_email = (ex_dict.get('email') or '').strip().lower()
                        # Només permetem activar si l'alumne és de la importació inicial i no tenia correu electrònic
                        if not ex_email:
                            student_id = ex_dict['id']
                            new_hash = hash_password(pin)
                            cursor.execute('''
                                UPDATE alumnes 
                                SET email = ?, pin = ?, password_hash = ?, nom = COALESCE(NULLIF(?, ''), nom), cognoms = COALESCE(NULLIF(?, ''), cognoms), telefon = COALESCE(NULLIF(?, ''), telefon)
                                WHERE id = ?
                            ''', (email, pin, new_hash, nom, cognoms, telefon, student_id))
                            conn.commit()

                            # Sincronitzar actualització a Google Sheets
                            sync_to_google_sheets_async('sync_alumne', {
                                'id': student_id,
                                'nom': nom or ex_dict.get('nom'),
                                'cognoms': cognoms or ex_dict.get('cognoms'),
                                'telefon': telefon or ex_dict.get('telefon'),
                                'email': email,
                                'pin': pin,
                                'data_alta': ex_dict.get('data_alta', ''),
                                'notes': ex_dict.get('notes', ''),
                                'actiu': 1
                            })

                            activated_student = {
                                'id': student_id,
                                'nom': nom or ex_dict.get('nom'),
                                'cognoms': cognoms or ex_dict.get('cognoms'),
                                'telefon': telefon or ex_dict.get('telefon'),
                                'email': email,
                                'data_alta': ex_dict.get('data_alta')
                            }
                            self.send_json({
                                'ok': True,
                                'id': student_id,
                                'alumne': activated_student,
                                'is_activation': True,
                                'message': f"Compte activat i vinculat correctament! El teu codi d'alumne és {student_id}."
                            })
                            return
                        else:
                            self.send_json({
                                'ok': False, 
                                'duplicate': True,
                                'error': f"Ja existeix un compte registrat amb aquest correu o telèfon ({ex_dict.get('id')}). Si has oblidat la contrasenya, utilitza l'opció de recuperació per WhatsApp.",
                                'code': 'ALREADY_REGISTERED'
                            }, 409)
                            return

                    # Generar nou ID: TC-101, TC-102, ...
                    cursor.execute('SELECT id FROM alumnes WHERE id LIKE "TC-%" ORDER BY id DESC')
                    existing = cursor.fetchall()
                    max_num = 100
                    for r in existing:
                        m = re.search(r'TC-(\d+)', r['id'])
                        if m:
                            max_num = max(max_num, int(m.group(1)))
                    student_id = f"TC-{max_num + 1}"
                    data_alta = get_now().strftime('%Y-%m-%dT%H:%M:%S')
                    new_hash = hash_password(pin)

                    cursor.execute('''
                        INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, password_hash, data_alta, notes, actiu)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    ''', (student_id, nom, cognoms, telefon, email, pin, new_hash, data_alta, notes))
                    conn.commit()

                # Sincronitzar amb Google Sheets si esta actiu
                sync_to_google_sheets_async('sync_alumne', {
                    'id': student_id,
                    'nom': nom,
                    'cognoms': cognoms,
                    'telefon': telefon,
                    'email': email,
                    'pin': pin,
                    'data_alta': data_alta,
                    'notes': notes,
                    'actiu': 1
                })

                created_student = {
                    'id': student_id,
                    'nom': nom,
                    'cognoms': cognoms,
                    'telefon': telefon,
                    'email': email,
                    'data_alta': data_alta
                }
                self.send_json({
                    'ok': True,
                    'id': student_id,
                    'alumne': created_student,
                    'message': f"Compte d'alumne creat correctament! El teu codi és {student_id}."
                })
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
                if not require_auth(self, data):
                    return
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

                hora_inici_req = (data.get('hora_inici') or data.get('horaInici') or '').strip()
                if not franja_id:
                    if hora_inici_req:
                        franja_id = 'T1' if hora_inici_req >= '14:00' else 'M1'
                    else:
                        franja_id = 'M1'

                # Si es proporciona un codi de val regal, validar-lo a la base de dades oficial
                if codi_val_regal:
                    val_obj = get_val_regal_db(codi_val_regal)
                    if not val_obj:
                        self.send_json({'ok': False, 'error': f"El codi de val regal '{codi_val_regal}' no és vàlid"}, 400)
                        return
                    if val_obj['estat'] != 'actiu':
                        self.send_json({'ok': False, 'error': f"Aquest val regal ja s'ha utilitzat o ha estat anul·lat (Estat: {val_obj['estat']})"}, 400)
                        return
                    today_chk = get_now().strftime('%Y-%m-%d')
                    if val_obj.get('data_caducitat') and val_obj['data_caducitat'] < today_chk:
                        self.send_json({'ok': False, 'error': f"Aquest val regal va caducar el {val_obj['data_caducitat']}"}, 400)
                        return
                    val_regal = 1
                    if not activitat_id or activitat_id == 'torn':
                        activitat_id = val_obj.get('activitat_id', 'torn')

                if not data_res:
                    self.send_json({'ok': False, 'error': 'Cal indicar la data de la reserva'}, 400)
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

                role_req = get_request_role(self, data)
                is_admin_req = (role_req in ('owner', 'staff'))
                forcar_aforament = bool(data.get('forcar_aforament') or data.get('ignorar_aforament') or data.get('force')) and is_admin_req

                # Validar dia tancat (dilluns/dimarts descans, festiu o vacances)
                estat_dia = is_dia_tancat(data_res)
                if estat_dia['tancat'] and not forcar_aforament:
                    self.send_json({'ok': False, 'error': estat_dia['motiu'], 'code': 'DIA_TANCAT'}, 400)
                    return

                act_list = get_activitats_config()
                act_obj = next((a for a in act_list if a['id'] == activitat_id or a['nom'].lower() == activitat_id or a['nom'].lower() == activitat_nom.lower()), None)
                if not act_obj:
                    act_obj = act_list[0]
                activitat_id = act_obj['id']
                activitat_nom = act_obj['nom']

                # Validar restricció d'activitats per a la data i torn
                is_tarda_req = (hora_inici_req >= '14:00') if hora_inici_req else (franja_id == 'T1')
                torn_req = 'tarda' if is_tarda_req else 'mati'
                restr_dia = get_restriccions_dia(data_res, torn_filtre=torn_req)
                if restr_dia['te_restriccio'] and activitat_id.lower() in restr_dia['bloquejades'] and not forcar_aforament:
                    motiu_txt = f" ({', '.join(restr_dia['motius'])})" if restr_dia['motius'] else ""
                    torn_txt = "a la tarda" if torn_req == 'tarda' else "al matí"
                    self.send_json({
                        'ok': False,
                        'error': f"L'activitat '{activitat_nom}' no està disponible {torn_txt} per a la data seleccionada{motiu_txt}.",
                        'code': 'ACTIVITAT_RESTRINGIDA'
                    }, 400)
                    return
                if forcar_aforament and '[SOBREAFORAMENT AUTORITZAT]' not in notes.upper():
                    notes = f"[SOBREAFORAMENT AUTORITZAT] {notes}".strip()

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

                is_tarda = (hora_inici_req >= '14:00')
                if is_tarda and (franja_id == 'M1' or not franja_id):
                    franja_id = 'T1'
                elif not is_tarda and (franja_id == 'T1' or not franja_id):
                    franja_id = 'M1'

                franges = get_franges_config()
                franja_obj = next((f for f in franges if f['id'] == franja_id or f['nom'] == franja_id), None)
                if not franja_obj:
                    franja_obj = next((f for f in franges if (f.get('inici') or '') >= '14:00'), None) if is_tarda else next((f for f in franges if (f.get('inici') or '') < '14:00'), None)
                if not franja_obj:
                    franja_obj = {"id": franja_id, "nom": "Tarda (17:00 - 20:00)" if is_tarda else "Matí (10:00 - 13:00)", "inici": "17:00" if is_tarda else "10:00", "fi": "20:00" if is_tarda else "13:00", "hores": 2.0}

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

                    # 1. Comprovar sempre l'aforament global del taller per al torn (Màx. 12 places globals - sempre es manté)
                    max_cap = get_aforament_maxim()
                    cursor.execute('''
                        SELECT SUM(COALESCE(places, 1)) as total_ocupades FROM reserves
                        WHERE data = ? AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                            (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                            (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                        )
                    ''', (data_res, 1 if is_tarda else 0, 1 if is_tarda else 0))
                    r_ocup = cursor.fetchone()
                    current_ocupat_franja = r_ocup['total_ocupades'] or 0
                    if current_ocupat_franja + places_demanades > max_cap:
                        lliures = max(0, max_cap - current_ocupat_franja)
                        torn_nom = "la tarda (17:00 - 20:00)" if is_tarda else "el matí (10:00 - 13:00)"
                        self.send_json({'ok': False, 'error': f"Aforament global del taller complet per al torn de {torn_nom}. Queden {lliures} de {max_cap} places en total al taller. No es pot superar el límit físic del local."}, 400)
                        return

                    # 2. Comprovar aforament particular de l'activitat (només si no s'ha marcat forçar places d'activitat)
                    if not forcar_aforament:
                        is_torn_family = activitat_id in ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') or 'torn' in activitat_id
                        if is_torn_family:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as act_ocupades FROM reserves
                                WHERE data = ? AND (LOWER(activitat_id) IN ('torn', 'experiencia_torn_adult', 'experiencia_torn_infant') OR LOWER(activitat) LIKE '%torn%') AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (data_res, 1 if is_tarda else 0, 1 if is_tarda else 0))
                        else:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as act_ocupades FROM reserves
                                WHERE data = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (data_res, activitat_id, activitat_nom.lower(), 1 if is_tarda else 0, 1 if is_tarda else 0))
                        r_act = cursor.fetchone()
                        current_ocupat_act = r_act['act_ocupades'] or 0
                        if current_ocupat_act + places_demanades > act_obj['capacitatMax']:
                            lliures_act = max(0, act_obj['capacitatMax'] - current_ocupat_act)
                            torn_nom = "la tarda" if is_tarda else "el matí"
                            self.send_json({'ok': False, 'error': f"No hi ha prou places per a {activitat_nom} en el torn de {torn_nom}. Queden {lliures_act} places d'aquesta activitat (Màx. {act_obj['capacitatMax']}). Com a administrador pots activar 'Permetre sobrepassar places d'activitat' si hi ha lloc al taller."}, 400)
                            return
    
                    # Proposta 1: Paga i Senyal per a reserves de 4 o més places (10 € / persona) o quan es sol·licita bestreta
                    paga_senyal_import = 0.0
                    estat_res = 'confirmada'
                    demanar_bestreta = bool(data.get('demanar_bestreta') or data.get('requereix_bestreta') or (data.get('paga_senyal') and float(data.get('paga_senyal')) > 0))
                    if (places_demanades >= 4 or demanar_bestreta) and not val_regal and not is_soc_alumne:
                        custom_ps = data.get('paga_senyal') or data.get('bestreta_import')
                        if custom_ps is not None:
                            try:
                                paga_senyal_import = float(custom_ps)
                            except Exception:
                                paga_senyal_import = float(places_demanades * 10.0)
                        else:
                            paga_senyal_import = float(places_demanades * 10.0)

                        if 'BESTRETA COBRADA' in notes.upper() or 'PAGADA' in notes.upper() or data.get('bestreta_cobrada'):
                            estat_res = 'confirmada'
                        else:
                            estat_res = 'pendent_paga_senyal'
                            if 'PAGA I SENYAL' not in notes.upper() and 'BESTRETA' not in notes.upper():
                                per_persona = int(round(paga_senyal_import / places_demanades)) if places_demanades else 10
                                notes = f"[PAGA I SENYAL: {int(paga_senyal_import)}€ PENDENT ({per_persona}€ x {places_demanades}p)] {notes}".strip()

                    res_id = f"RES-{int(get_now().timestamp())}-{student_id}"
                    now_iso = get_now().strftime('%Y-%m-%dT%H:%M:%S')
                    cal_event_id = (data.get('calendar_event_id') or '').strip() or None
                    cursor.execute('''
                        INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, email, estat, hores, notes, created_at, calendar_event_id, val_regal, codi_val_regal, paga_senyal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        res_id, student_id, student_nom, data_res,
                        hora_inici_req, hora_fi_req,
                        franja_obj['id'], activitat_nom, activitat_id, places_demanades, telefon, email,
                        estat_res, hores_req, notes, now_iso, cal_event_id, val_regal, codi_val_regal, paga_senyal_import
                    ))
                    conn.commit()

                # Si és una reserva amb Val Regal, marcar el val com a bescanviat
                if codi_val_regal:
                    try:
                        bescanviar_val_regal_db(codi_val_regal, res_id, alumne_id=student_id)
                    except Exception as e_val:
                        print(f"[Val Regal] Error marcant val {codi_val_regal} com a canviat: {e_val}")

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
                    'estat': estat_res,
                    'paga_senyal': paga_senyal_import,
                    'requereix_paga_senyal': bool(paga_senyal_import > 0),
                    'hores': hores_req,
                    'notes': notes,
                    'created_at': now_iso,
                    'calendar_event_id': cal_event_id,
                    'calendar_name': cal_name
                }

                # Sincronitzar reserva a Google Sheets i Google Calendar
                sync_to_google_sheets_async('add_reserva', reserva_dict)

                # Disparar confirmació per WhatsApp (Whapi.cloud QR o Meta Cloud API)
                if telefon:
                    def _mark_conf_done(wa_res, rid=res_id):
                        try:
                            with get_db() as conn_up:
                                conn_up.cursor().execute("UPDATE reserves SET whatsapp_notif_confirm = 1 WHERE id = ?", (rid,))
                                conn_up.commit()
                        except Exception:
                            pass

                    notif_rendered = render_notification('reserva_creada', reserva_dict)
                    send_whatsapp_whapi_async(telefon, notif_rendered.get('wa_missatge') or '', on_success_cb=_mark_conf_done, res_id=res_id, include_buttons=True, send_logo=True)

                # Disparar workflow automàtic a n8n Cloud (notificacions WhatsApp + Email)
                trigger_n8n_event_async('reserva_creada', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': 'Reserva confirmada correctament!',
                    'reserva': reserva_dict
                })
                return


            elif path == '/api/reserves/recurrent-preview':
                data_inici = (data.get('data_inici') or data.get('data') or '').strip()
                frequencia = (data.get('frequencia') or 'setmanal').strip().lower()
                interval_dies = data.get('interval_dies') or data.get('interval_days')
                exclude_rec_id = (data.get('exclude_recurrent_id') or data.get('recurrent_id') or '').strip()
                repeticions = int(data.get('repeticions') or data.get('sessions') or 4)
                if repeticions < 1:
                    repeticions = 1
                if repeticions > 52:
                    repeticions = 52
                activitat_id = (data.get('activitat_id') or 'torn').strip().lower()
                places_demanades = int(data.get('places') or 1)
                saltar_tancats = bool(data.get('saltar_tancats', True))
                hora_inici_req = (data.get('hora_inici') or data.get('horaInici') or '10:00').strip()
                is_tarda = (hora_inici_req >= '14:00')

                if not data_inici:
                    self.send_json({'ok': False, 'error': "Cal indicar la data d'inici"}, 400)
                    return

                act_list = get_activitats_config()
                act_obj = next((a for a in act_list if a['id'] == activitat_id or a['nom'].lower() == activitat_id), None)
                if not act_obj:
                    act_obj = act_list[0]

                dates_valides, dates_saltades = calculate_recurring_dates(data_inici, frequencia, repeticions, saltar_tancats, activitat_id=act_obj['id'], interval_days=interval_dies)
                max_cap = get_aforament_maxim()

                preview = []
                with get_db() as conn:
                    cursor = conn.cursor()
                    for d in dates_valides:
                        if exclude_rec_id:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as total FROM reserves
                                WHERE data = ? AND (recurrent_id IS NULL OR (recurrent_id != ? AND id NOT LIKE ? || '%'))
                                  AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d, exclude_rec_id, exclude_rec_id, 1 if is_tarda else 0, 1 if is_tarda else 0))
                        else:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as total FROM reserves
                                WHERE data = ? AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d, 1 if is_tarda else 0, 1 if is_tarda else 0))
                        tot = cursor.fetchone()['total'] or 0
                        lliures_global = max(0, max_cap - tot)

                        if exclude_rec_id:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as act_tot FROM reserves
                                WHERE data = ? AND (recurrent_id IS NULL OR (recurrent_id != ? AND id NOT LIKE ? || '%'))
                                  AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d, exclude_rec_id, exclude_rec_id, act_obj['id'], act_obj['nom'].lower(), 1 if is_tarda else 0, 1 if is_tarda else 0))
                        else:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as act_tot FROM reserves
                                WHERE data = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d, act_obj['id'], act_obj['nom'].lower(), 1 if is_tarda else 0, 1 if is_tarda else 0))
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

                is_tarda = (hora_inici_req >= '14:00')
                if is_tarda and (franja_id == 'M1' or not franja_id):
                    franja_id = 'T1'
                elif not is_tarda and (franja_id == 'T1' or not franja_id):
                    franja_id = 'M1'

                franges = get_franges_config()
                franja_obj = next((f for f in franges if f['id'] == franja_id or f['nom'] == franja_id), None)
                if not franja_obj:
                    franja_obj = next((f for f in franges if (f.get('inici') or '') >= '14:00'), None) if is_tarda else next((f for f in franges if (f.get('inici') or '') < '14:00'), None)
                if not franja_obj:
                    franja_obj = {"id": franja_id, "nom": "Tarda (17:00 - 20:00)" if is_tarda else "Matí (10:00 - 13:00)", "inici": "17:00" if is_tarda else "10:00", "fi": "20:00" if is_tarda else "13:00", "hores": 2.0}

                # Calcular dates
                dates_valides, dates_saltades = calculate_recurring_dates(data_inici, frequencia, repeticions, saltar_tancats, activitat_id=activitat_id)
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

                    role_rec = get_request_role(self, data)
                    is_admin_rec = (role_rec in ('owner', 'staff'))
                    forcar_aforament = bool(data.get('forcar_aforament') or data.get('ignorar_aforament') or data.get('force')) and is_admin_rec
                    if forcar_aforament and '[SOBREAFORAMENT AUTORITZAT]' not in notes.upper():
                        notes = f"[SOBREAFORAMENT AUTORITZAT] {notes}".strip()

                    if not forcar_aforament:
                        for d_val in dates_valides:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as total_ocupades FROM reserves
                                WHERE data = ? AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d_val, 1 if is_tarda else 0, 1 if is_tarda else 0))
                            r_ocup = cursor.fetchone()
                            current_ocupat_dia = r_ocup['total_ocupades'] or 0
                            if current_ocupat_dia + places_demanades > max_cap:
                                lliures = max(0, max_cap - current_ocupat_dia)
                                torn_nom = "tarda" if is_tarda else "matí"
                                dates_amb_conflicte.append(f"{d_val}: Aforament ({torn_nom}) complet ({lliures} lliures de {max_cap})")
                                continue
    
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as act_ocupades FROM reserves
                                WHERE data = ? AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d_val, activitat_id, activitat_nom.lower(), 1 if is_tarda else 0, 1 if is_tarda else 0))
                            r_act = cursor.fetchone()
                            current_ocupat_act = r_act['act_ocupades'] or 0
                            if current_ocupat_act + places_demanades > act_obj['capacitatMax']:
                                lliures_act = max(0, act_obj['capacitatMax'] - current_ocupat_act)
                                torn_nom = "tarda" if is_tarda else "matí"
                                dates_amb_conflicte.append(f"{d_val}: Places de {activitat_nom} ({torn_nom}) completes ({lliures_act} lliures de {act_obj['capacitatMax']})")
    
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

                    conn.commit()

                    def _sync_recurrent_batch(res_list):
                        for r_item in res_list:
                            sync_to_google_sheets_async('add_reserva', r_item)
                            time.sleep(0.4)
                    threading.Thread(target=_sync_recurrent_batch, args=(list(created_reserves),), daemon=True).start()

                # Disparar notificació n8n per a la confirmació de la primera cita de la sèrie
                if created_reserves:
                    trigger_n8n_event_async('reserva_creada', created_reserves[0])

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
                res_id = (data.get('id') or data.get('reserva_id') or '').strip()
                from_date = (data.get('from_date') or data.get('a_partir_de_data') or '').strip()
                target_key = recurrent_id or res_id
                if not target_key:
                    self.send_json({'ok': False, 'error': "Cal indicar l'identificador de la sèrie recurrent (recurrent_id)"}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT recurrent_id FROM reserves WHERE id = ? LIMIT 1", (target_key,))
                    r_found = cursor.fetchone()
                    effective_rec_id = (r_found['recurrent_id'] if r_found and r_found['recurrent_id'] else target_key)

                    query_where = "(recurrent_id = ? OR id LIKE ? || '%')"
                    query_params = [effective_rec_id, effective_rec_id]
                    if from_date:
                        query_where += " AND data >= ?"
                        query_params.append(from_date)
                    query_where += " AND LOWER(estat) NOT LIKE 'cancel%' AND LOWER(estat) != 'eliminada'"

                    cursor.execute(f"SELECT * FROM reserves WHERE {query_where}", query_params)
                    rows = [row_to_dict(r) for r in cursor.fetchall()]
                    if not rows:
                        self.send_json({'ok': False, 'error': "No s'ha trobat cap reserva activa per a aquesta sèrie"}, 404)
                        return

                    update_where = "(recurrent_id = ? OR id LIKE ? || '%')"
                    update_params = [effective_rec_id, effective_rec_id]
                    if from_date:
                        update_where += " AND data >= ?"
                        update_params.append(from_date)
                    update_where += " AND LOWER(estat) NOT LIKE 'cancel%' AND LOWER(estat) != 'eliminada'"

                    cursor.execute(f"UPDATE reserves SET estat = 'cancel·lada' WHERE {update_where}", update_params)
                    conn.commit()

                for r in rows:
                    r['estat'] = 'cancel·lada'
                    sync_to_google_sheets_async('cancel_reserva', r)

                self.send_json({
                    'ok': True,
                    'message': f"S'han cancel·lat {len(rows)} reserves de la sèrie recurrent i s'han alliberat les places.",
                    'total_cancelades': len(rows),
                    'recurrent_id': effective_rec_id
                })
                return

            elif path == '/api/reserves/cancel':
                res_id = (data.get('id') or '').strip()
                if not res_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'ID de la reserva"}, 400)
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

                # Disparar workflow n8n per avís de cancel·lació
                trigger_n8n_event_async('reserva_cancelada', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': 'Reserva cancel·lada correctament i plaça alliberada.',
                    'reserva': reserva_dict
                })

                return

            elif path == '/api/reserves/sync-calendar':
                res = sync_calendar_from_google()
                self.send_json(res, 200 if res.get('ok') else 400)
                return

            elif path == '/api/reserves/update-serie':
                recurrent_id = (data.get('recurrent_id') or '').strip()
                res_id = (data.get('id') or data.get('reserva_id') or '').strip()
                target_key = recurrent_id or res_id
                if not target_key:
                    self.send_json({'ok': False, 'error': "Cal indicar l'identificador de la sèrie o d'una de les seves reserves"}, 400)
                    return

                data_inici = (data.get('data_inici') or data.get('data') or '').strip()
                frequencia = (data.get('frequencia') or 'setmanal').strip().lower()
                interval_dies = data.get('interval_dies') or data.get('interval_days')
                repeticions = int(data.get('repeticions') or data.get('sessions') or 4)
                if repeticions < 1:
                    repeticions = 1
                if repeticions > 52:
                    repeticions = 52

                nova_hora_inici = (data.get('hora_inici') or '').strip()
                nova_hora_fi = (data.get('hora_fi') or '').strip()
                role_serie = get_request_role(self, data)
                is_admin_serie = (role_serie in ('owner', 'staff'))
                forcar_aforament = bool(data.get('forcar_aforament', False)) and is_admin_serie
                saltar_tancats = bool(data.get('saltar_tancats', True))

                if not data_inici:
                    self.send_json({'ok': False, 'error': "Cal indicar la data d'inici de la sèrie"}, 400)
                    return
                if not nova_hora_inici or not nova_hora_fi:
                    self.send_json({'ok': False, 'error': "Cal indicar l'hora d'inici i de fi"}, 400)
                    return

                # Calcular hores durada
                try:
                    t1 = datetime.strptime(nova_hora_inici, '%H:%M')
                    t2 = datetime.strptime(nova_hora_fi, '%H:%M')
                    diff_h = (t2 - t1).total_seconds() / 3600.0
                    hores_val = max(0.5, round(diff_h, 2))
                except Exception:
                    hores_val = float(data.get('hores') or 2.0)

                is_tarda = (nova_hora_inici >= '14:00')
                nova_franja = 'T1' if is_tarda else 'M1'

                with get_db() as conn:
                    cursor = conn.cursor()

                    # Obtenir reserves existents de la sèrie
                    cursor.execute("SELECT * FROM reserves WHERE id = ?", (target_key,))
                    base_row = cursor.fetchone()

                    effective_rec_id = recurrent_id
                    if not effective_rec_id and base_row:
                        effective_rec_id = base_row['recurrent_id']
                        if not effective_rec_id and base_row['id'].startswith('RES-'):
                            parts = base_row['id'].split('-')
                            if len(parts) >= 4:
                                effective_rec_id = '-'.join(parts[:3])

                    if not effective_rec_id:
                        effective_rec_id = target_key

                    cursor.execute('''
                        SELECT * FROM reserves 
                        WHERE (recurrent_id = ? OR id LIKE ? || '%')
                          AND LOWER(estat) NOT LIKE 'cancel%'
                          AND LOWER(estat) != 'eliminada'
                        ORDER BY data ASC, hora_inici ASC
                    ''', (effective_rec_id, effective_rec_id))
                    existing_rows = [row_to_dict(r) for r in cursor.fetchall()]

                    if not existing_rows:
                        if base_row:
                            existing_rows = [row_to_dict(base_row)]
                        else:
                            self.send_json({'ok': False, 'error': "No s'ha trobat cap reserva activa per a aquesta sèrie"}, 404)
                            return

                    ref_meta = existing_rows[0]
                    student_id = ref_meta.get('student_id') or ''
                    student_nom = ref_meta.get('student_nom') or ''
                    telefon = ref_meta.get('telefon') or ''
                    email = ref_meta.get('email') or ''
                    activitat = ref_meta.get('activitat') or 'Torn'
                    activitat_id = (ref_meta.get('activitat_id') or 'torn').strip().lower()
                    places = int(ref_meta.get('places') or 1)
                    paga_senyal = ref_meta.get('paga_senyal') or 0
                    val_regal = ref_meta.get('val_regal') or 0
                    codi_val_regal = ref_meta.get('codi_val_regal') or ''

                    # Calcular les noves dates de la sèrie
                    dates_valides, dates_saltades = calculate_recurring_dates(
                        data_inici,
                        frequency=frequencia,
                        repetitions=repeticions,
                        skip_closed=saltar_tancats,
                        activitat_id=activitat_id,
                        interval_days=interval_dies
                    )

                    if not dates_valides:
                        self.send_json({'ok': False, 'error': "No s'ha pogut programar cap sessió amb aquests paràmetres (dies tancats o restringits)"}, 400)
                        return

                    # Comprovar aforament per a cadascuna de les noves dates (excloent la sèrie pròpia)
                    max_cap = get_aforament_maxim()
                    act_list = get_activitats_config()
                    act_obj = next((a for a in act_list if a['id'] == activitat_id or a['nom'].lower() == activitat_id), None)
                    cap_act = act_obj['capacitatMax'] if act_obj else 4

                    for d in dates_valides:
                        # 1. Comprovació global estricta (Màx. 12 places simultànies - sempre es manté)
                        cursor.execute('''
                            SELECT SUM(COALESCE(places, 1)) as tot FROM reserves
                            WHERE data = ? AND (recurrent_id IS NULL OR (recurrent_id != ? AND id NOT LIKE ? || '%'))
                              AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                            )
                        ''', (d, effective_rec_id, effective_rec_id, 1 if is_tarda else 0, 1 if is_tarda else 0))
                        tot_global = cursor.fetchone()['tot'] or 0
                        if tot_global + places > max_cap:
                            self.send_json({
                                'ok': False,
                                'error': f"Aforament global del taller complet el {d} (queden {max(0, max_cap - tot_global)} de {max_cap} places en total). No es pot sobrepassar el límit físic del taller."
                            }, 400)
                            return

                        # 2. Comprovació de places de l'activitat (només si no es forcen places d'activitat)
                        if not forcar_aforament:
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as tot_act FROM reserves
                                WHERE data = ? AND (recurrent_id IS NULL OR (recurrent_id != ? AND id NOT LIKE ? || '%'))
                                  AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?)
                                  AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                )
                            ''', (d, effective_rec_id, effective_rec_id, activitat_id, activitat.lower(), 1 if is_tarda else 0, 1 if is_tarda else 0))
                            tot_act = cursor.fetchone()['tot_act'] or 0
                            if tot_act + places > cap_act:
                                self.send_json({
                                    'ok': False,
                                    'error': f"Places de {activitat} completes el {d} (queden {max(0, cap_act - tot_act)} places). Pots activar 'Permetre sobrepassar places d'activitat' per autoritzar-ho."
                                }, 400)
                                return

                    # Execució del canvi
                    N = len(dates_valides)
                    M = len(existing_rows)
                    K = min(N, M)
                    now_iso = get_now().isoformat()

                    updated_reserves = []
                    cancelled_reserves = []

                    # 1. Actualitzar les K sessions compartides
                    for i in range(K):
                        r_curr = existing_rows[i]
                        d_new = dates_valides[i]
                        note_txt = f"[Recurrent {i+1}/{N}]"
                        if r_curr.get('notes') and '[Recurrent' not in r_curr['notes']:
                            note_txt = f"{r_curr['notes']} {note_txt}".strip()

                        cursor.execute('''
                            UPDATE reserves 
                            SET data = ?, hora_inici = ?, hora_fi = ?, franja = ?, hores = ?, recurrent_id = ?, notes = ?
                            WHERE id = ?
                        ''', (d_new, nova_hora_inici, nova_hora_fi, nova_franja, hores_val, effective_rec_id, note_txt, r_curr['id']))

                        cursor.execute("SELECT * FROM reserves WHERE id = ?", (r_curr['id'],))
                        updated_reserves.append(row_to_dict(cursor.fetchone()))

                    # 2. Si s'ha allargat la sèrie (N > M), crear les noves sessions
                    if N > M:
                        for i in range(M, N):
                            new_id = f"{effective_rec_id}-{i+1}"
                            d_new = dates_valides[i]
                            note_txt = f"[Recurrent {i+1}/{N}]"

                            cursor.execute('''
                                INSERT INTO reserves (
                                    id, student_id, student_nom, data, hora_inici, hora_fi, franja,
                                    activitat, activitat_id, places, telefon, email, estat, hores,
                                    notes, created_at, recurrent_id, paga_senyal, val_regal, codi_val_regal
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?, ?, ?, ?, ?, ?, ?)
                            ''', (
                                new_id, student_id, student_nom, d_new, nova_hora_inici, nova_hora_fi, nova_franja,
                                activitat, activitat_id, places, telefon, email, hores_val,
                                note_txt, now_iso, effective_rec_id, paga_senyal, val_regal, codi_val_regal
                            ))
                            cursor.execute("SELECT * FROM reserves WHERE id = ?", (new_id,))
                            updated_reserves.append(row_to_dict(cursor.fetchone()))

                    # 3. Si s'ha escurçat la sèrie (N < M), cancel·lar les sessions sobrants
                    elif N < M:
                        for i in range(N, M):
                            r_canc = existing_rows[i]
                            cursor.execute("UPDATE reserves SET estat = 'cancel·lada' WHERE id = ?", (r_canc['id'],))
                            cursor.execute("SELECT * FROM reserves WHERE id = ?", (r_canc['id'],))
                            cancelled_reserves.append(row_to_dict(cursor.fetchone()))

                    conn.commit()

                # Sincronitzar canvis a Google Sheets
                for u in updated_reserves:
                    sync_to_google_sheets_async('update_reserva', u)
                for c in cancelled_reserves:
                    sync_to_google_sheets_async('cancel_reserva', c)

                self.send_json({
                    'ok': True,
                    'message': f"Sèrie recurrent reprogramada amb èxit! Total: {N} sessions a {nova_hora_inici} - {nova_hora_fi} ({hores_val}h).",
                    'total_sessions': N,
                    'dates': dates_valides,
                    'recurrent_id': effective_rec_id,
                    'reserves': updated_reserves
                })
                return

            elif path == '/api/reserves/update-horari':
                res_id = (data.get('id') or data.get('reserva_id') or '').strip()
                scope = (data.get('scope') or 'single').strip().lower()
                nova_data = (data.get('data') or data.get('nova_data') or '').strip()
                nova_hora_inici = (data.get('hora_inici') or '').strip()
                role_upd = get_request_role(self, data)
                is_admin_upd = (role_upd in ('owner', 'staff'))
                forcar_aforament = bool(data.get('forcar_aforament', False)) and is_admin_upd

                if not res_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'ID de la reserva"}, 400)
                    return
                if not nova_hora_inici or not nova_hora_fi:
                    self.send_json({'ok': False, 'error': "Cal indicar tant l'hora d'inici com l'hora de fi"}, 400)
                    return

                if nova_data:
                    try:
                        datetime.strptime(nova_data, '%Y-%m-%d')
                    except ValueError:
                        self.send_json({'ok': False, 'error': "Format de data invàlid (ha de ser AAAA-MM-DD)"}, 400)
                        return

                # Calcular hores durada
                try:
                    t1 = datetime.strptime(nova_hora_inici, '%H:%M')
                    t2 = datetime.strptime(nova_hora_fi, '%H:%M')
                    diff_h = (t2 - t1).total_seconds() / 3600.0
                    hores_val = max(0.5, round(diff_h, 2))
                except Exception:
                    hores_val = float(data.get('hores') or 2.0)

                is_tarda = (nova_hora_inici >= '14:00')
                nova_franja = 'T1' if is_tarda else 'M1'

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT * FROM reserves WHERE id = ?", (res_id,))
                    target_row = cursor.fetchone()
                    if not target_row:
                        self.send_json({'ok': False, 'error': "Reserva no trobada"}, 404)
                        return

                    target_dict = row_to_dict(target_row)
                    reserves_to_update = []

                    if scope == 'serie':
                        # Buscar sèrie recurrent
                        rec_id = target_dict.get('recurrent_id') or ''
                        if not rec_id and target_dict.get('id', '').startswith('RES-'):
                            parts = target_dict['id'].split('-')
                            if len(parts) >= 4:
                                rec_id = '-'.join(parts[:3])

                        from_date = target_dict.get('data') or ''
                        if rec_id:
                            cursor.execute('''
                                SELECT * FROM reserves 
                                WHERE (recurrent_id = ? OR id LIKE ? || '%') 
                                  AND data >= ? 
                                  AND LOWER(estat) NOT LIKE 'cancel%' 
                                  AND LOWER(estat) != 'eliminada'
                                ORDER BY data ASC
                            ''', (rec_id, rec_id, from_date))
                            reserves_to_update = [row_to_dict(r) for r in cursor.fetchall()]

                    if not reserves_to_update:
                        reserves_to_update = [target_dict]

                    # Comprovar aforament per a cada reserva: el màxim global del taller es respecta sempre
                    max_cap = get_aforament_maxim()
                    for r_item in reserves_to_update:
                        d_item = nova_data if (scope != 'serie' and nova_data) else r_item['data']
                        curr_id = r_item['id']
                        pl_dem = int(r_item.get('places') or 1)
                        act_id = (r_item.get('activitat_id') or 'torn').strip().lower()
                        act_nom = (r_item.get('activitat') or 'Torn').strip().lower()

                        # Aforament global de la franja excloent la reserva pròpia
                        cursor.execute('''
                            SELECT SUM(COALESCE(places, 1)) as total_ocup FROM reserves
                            WHERE data = ? AND id != ? AND estat IN ('confirmada', 'pendent_paga_senyal') AND (
                                (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                            )
                        ''', (d_item, curr_id, 1 if is_tarda else 0, 1 if is_tarda else 0))
                        r_tot = cursor.fetchone()
                        ocup_tot = r_tot['total_ocup'] or 0
                        if ocup_tot + pl_dem > max_cap:
                            torn_desc = "la tarda" if is_tarda else "el matí"
                            lliures = max(0, max_cap - ocup_tot)
                            self.send_json({
                                'ok': False,
                                'error': f"Aforament global del taller complet el {d_item} per a {torn_desc} ({nova_hora_inici} - {nova_hora_fi}). Queden {lliures} de {max_cap} places en total. No es pot superar el límit físic del local."
                            }, 400)
                            return

                        # Comprovació de límit específic d'activitat si no s'ha marcat forçar
                        if not forcar_aforament:
                            limit_act = 4 if ('torn' in act_id or 'torn' in act_nom) else (12 if ('pintar' in act_id or 'pintar' in act_nom) else 8)
                            cursor.execute('''
                                SELECT SUM(COALESCE(places, 1)) as act_ocup FROM reserves
                                WHERE data = ? AND id != ? AND estat IN ('confirmada', 'pendent_paga_senyal') 
                                  AND (LOWER(activitat_id) = ? OR LOWER(activitat) = ?)
                                  AND (
                                    (? = 1 AND (franja = 'T1' OR hora_inici >= '14:00')) OR
                                    (? = 0 AND (franja = 'M1' OR hora_inici < '14:00' OR franja IS NULL))
                                  )
                            ''', (d_item, curr_id, act_id, act_nom, 1 if is_tarda else 0, 1 if is_tarda else 0))
                            r_act = cursor.fetchone()
                            act_ocup = r_act['act_ocup'] or 0
                            if act_ocup + pl_dem > limit_act:
                                torn_desc = "la tarda" if is_tarda else "el matí"
                                lliures_act = max(0, limit_act - act_ocup)
                                self.send_json({
                                    'ok': False,
                                    'error': f"Places de {r_item.get('activitat', 'activitat')} completes per a {torn_desc} el {d_item} ({act_ocup}/{limit_act} ocupades). Pots marcar la casella 'Permetre sobrepassar places d'activitat' si vols afegir-la igualment (mentre quedi aforament global)."
                                }, 400)
                                return

                    # Executar l'actualització del dia i de l'horari
                    updated_rows = []
                    for r_item in reserves_to_update:
                        curr_id = r_item['id']
                        d_val = nova_data if (scope != 'serie' and nova_data) else r_item['data']
                        cursor.execute('''
                            UPDATE reserves 
                            SET data = ?, hora_inici = ?, hora_fi = ?, franja = ?, hores = ?
                            WHERE id = ?
                        ''', (d_val, nova_hora_inici, nova_hora_fi, nova_franja, hores_val, curr_id))
                        cursor.execute("SELECT * FROM reserves WHERE id = ?", (curr_id,))
                        u_row = cursor.fetchone()
                        if u_row:
                            u_dict = row_to_dict(u_row)
                            updated_rows.append(u_dict)
                    conn.commit()

                # Sincronitzar a Google Sheets
                for u_dict in updated_rows:
                    sync_to_google_sheets_async('update_reserva', u_dict)

                cnt = len(updated_rows)
                first_date = updated_rows[0]['data'] if updated_rows else nova_data
                msg = f"S'ha actualitzat la reserva al {first_date} de {nova_hora_inici} a {nova_hora_fi} ({hores_val}h)." if cnt == 1 else f"S'ha actualitzat l'horari de {cnt} sessions de la sèrie recurrent a {nova_hora_inici} - {nova_hora_fi} ({hores_val}h)."
                self.send_json({
                    'ok': True,
                    'message': msg,
                    'total_actualitzades': cnt,
                    'data': first_date,
                    'hora_inici': nova_hora_inici,
                    'hora_fi': nova_hora_fi,
                    'hores': hores_val
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

            elif path == '/api/reserves/cobrar-bestreta':
                res_id = (data.get('id') or '').strip()
                metode = (data.get('metode') or 'TPV Físic (Taller)').strip()
                import_pagat = data.get('import')

                if not res_id:
                    self.send_json({'ok': False, 'error': 'Cal indicar l\'ID de la reserva'}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT * FROM reserves WHERE id = ?", (res_id,))
                    row = cursor.fetchone()
                    if not row:
                        self.send_json({'ok': False, 'error': 'Reserva no trobada'}, 404)
                        return

                    paga_num = float(row['paga_senyal'] or (row['places'] * 10.0))
                    if import_pagat:
                        try:
                            paga_num = float(import_pagat)
                        except Exception:
                            pass

                    old_notes = row['notes'] or ''
                    cleaned_notes = old_notes.replace('PENDENT', 'COBRADA')
                    if 'COBRADA' not in cleaned_notes:
                        cleaned_notes = f"{cleaned_notes} [BESTRETA COBRADA: {int(paga_num)}€ per {metode}]".strip()

                    cursor.execute("""
                        UPDATE reserves 
                        SET estat = 'confirmada', paga_senyal = ?, notes = ? 
                        WHERE id = ?
                    """, (paga_num, cleaned_notes, res_id))
                    conn.commit()

                    cursor.execute("SELECT * FROM reserves WHERE id = ?", (res_id,))
                    row_updated = cursor.fetchone()
                    reserva_dict = row_to_dict(row_updated)

                sync_to_google_sheets_async('update_reserva_estat', reserva_dict)

                self.send_json({
                    'ok': True,
                    'message': f"Bestreta de {int(paga_num)}€ registrada com a cobrada per {metode}.",
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
                    cursor.execute('UPDATE activitats SET capacitat_max = ? WHERE id = "torn"', (max(1, cap_torn),))
                    cursor.execute('UPDATE activitats SET capacitat_max = ? WHERE id = "modelatge"', (max(1, cap_modelatge),))
                    cursor.execute('UPDATE activitats SET capacitat_max = ? WHERE id = "pintar"', (max(1, cap_pintar),))
                    conn.commit()

                new_acts = get_activitats_config()
                sync_to_google_sheets_async('save_config', {
                    'capacitat_max_torn': str(cap_torn),
                    'capacitat_max_modelatge': str(cap_modelatge),
                    'capacitat_max_pintar': str(cap_pintar)
                })
                self.send_json({'ok': True, 'message': "Capacitats d'activitat actualitzades correctament!", 'activitats': new_acts})
                return

            elif path == '/api/activitats':
                nom = (data.get('nom') or data.get('name') or '').strip()
                if not nom:
                    self.send_json({'ok': False, 'error': 'El nom del taller és obligatori'}, 400)
                    return

                try:
                    cap_max = int(data.get('capacitat_max') or data.get('capacitatMax') or 4)
                    if cap_max < 1:
                        cap_max = 1
                except (ValueError, TypeError):
                    cap_max = 4

                color = (data.get('color') or '#B91C1C').strip()
                descripcio = (data.get('descripcio') or data.get('description') or '').strip()
                custom_id = (data.get('id') or '').strip().lower()

                base_id = slugify_activity_id(custom_id if custom_id else nom)
                act_id = base_id
                counter = 2

                with get_db() as conn:
                    cursor = conn.cursor()
                    while True:
                        cursor.execute('SELECT COUNT(*) as cnt FROM activitats WHERE id = ?', (act_id,))
                        if cursor.fetchone()['cnt'] == 0:
                            break
                        act_id = f"{base_id}-{counter}"
                        counter += 1

                    cursor.execute('SELECT COALESCE(MAX(ordre), 0) + 1 as max_ord FROM activitats')
                    next_ordre = cursor.fetchone()['max_ord']

                    cursor.execute('''
                        INSERT INTO activitats (id, nom, descripcio, capacitat_max, color, actiu, ordre)
                        VALUES (?, ?, ?, ?, ?, 1, ?)
                    ''', (act_id, nom, descripcio, cap_max, color, next_ordre))
                    conn.commit()

                all_acts = get_activitats_config(include_inactive=True)
                new_act = next((a for a in all_acts if a['id'] == act_id), None)
                self.send_json({
                    'ok': True,
                    'message': f"Taller '{nom}' creat correctament",
                    'activitat': new_act,
                    'activitats': all_acts
                })
                return

            elif path in ('/api/activitats/update', '/api/activitats/modificar'):
                act_id = (data.get('id') or '').strip().lower()
                if not act_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'identificador del taller"}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM activitats WHERE id = ?', (act_id,))
                    existing = cursor.fetchone()
                    if not existing:
                        self.send_json({'ok': False, 'error': f"No s'ha trobat el taller '{act_id}'"}, 404)
                        return

                    nom = (data.get('nom') or existing['nom']).strip()
                    descripcio = data.get('descripcio') if 'descripcio' in data else existing['descripcio']
                    color = (data.get('color') or existing['color']).strip()

                    if 'capacitat_max' in data or 'capacitatMax' in data:
                        try:
                            cap_max = int(data.get('capacitat_max') or data.get('capacitatMax'))
                            if cap_max < 1:
                                cap_max = 1
                        except (ValueError, TypeError):
                            cap_max = int(existing['capacitat_max'])
                    else:
                        cap_max = int(existing['capacitat_max'])

                    if 'actiu' in data:
                        actiu = 1 if data.get('actiu') in (1, True, '1', 'true', 'True') else 0
                    else:
                        actiu = int(existing['actiu'])

                    ordre = int(data.get('ordre') or existing['ordre'] or 0)

                    cursor.execute('''
                        UPDATE activitats
                        SET nom = ?, descripcio = ?, capacitat_max = ?, color = ?, actiu = ?, ordre = ?
                        WHERE id = ?
                    ''', (nom, descripcio, cap_max, color, actiu, ordre, act_id))

                    if act_id in ('torn', 'modelatge', 'pintar'):
                        cfg_key = f"capacitat_max_{act_id}"
                        cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (cfg_key, str(cap_max)))
                        sync_to_google_sheets_async('save_config', {cfg_key: str(cap_max)})

                    conn.commit()

                all_acts = get_activitats_config(include_inactive=True)
                updated_act = next((a for a in all_acts if a['id'] == act_id), None)
                self.send_json({
                    'ok': True,
                    'message': f"Taller '{nom}' actualitzat correctament",
                    'activitat': updated_act,
                    'activitats': all_acts
                })
                return

            elif path in ('/api/activitats/delete', '/api/activitats/eliminar'):
                act_id = (data.get('id') or params.get('id', [''])[0]).strip().lower()
                if not act_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'identificador del taller"}, 400)
                    return

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM activitats WHERE id = ?', (act_id,))
                    existing = cursor.fetchone()
                    if not existing:
                        self.send_json({'ok': False, 'error': f"No s'ha trobat el taller '{act_id}'"}, 404)
                        return

                    cursor.execute('''
                        SELECT COUNT(*) as cnt FROM reserves 
                        WHERE (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) 
                        AND LOWER(estat) NOT LIKE 'cancel%' AND LOWER(estat) != 'eliminada'
                    ''', (act_id, existing['nom'].lower()))
                    res_cnt = cursor.fetchone()['cnt']

                    if res_cnt > 0 or act_id in ('torn', 'modelatge', 'pintar'):
                        cursor.execute('UPDATE activitats SET actiu = 0 WHERE id = ?', (act_id,))
                        conn.commit()
                        action = 'desactivat'
                        msg = f"El taller '{existing['nom']}' té reserves associades o és un taller principal; s'ha desactivat per mantenir l'historial."
                    else:
                        cursor.execute('DELETE FROM activitats WHERE id = ?', (act_id,))
                        conn.commit()
                        action = 'eliminat'
                        msg = f"El taller '{existing['nom']}' s'ha eliminat correctament."

                all_acts = get_activitats_config(include_inactive=True)
                self.send_json({
                    'ok': True,
                    'action': action,
                    'message': msg,
                    'activitats': all_acts
                })
                return

            elif path in ('/api/whatsapp/webhook', '/api/whapi/webhook'):
                # Processa immediatament les notificacions i clics de WhatsApp (Whapi)
                sync_res = sync_whapi_inbound_messages()
                self.send_json({'ok': True, 'processed': sync_res.get('processed', 0)})
                return

            elif path == '/api/whatsapp/disconnect':
                res = disconnect_wa_gateway()
                self.send_json(res)
                return

            elif path == '/api/whatsapp/internal-inbound':
                sender = data.get('sender_phone')
                text = data.get('text', '')
                msg_id = data.get('msg_id')
                res = process_wa_inbound_message(sender, text, msg_id)
                self.send_json(res)
                return

            elif path == '/api/whatsapp/internal-auth-backup':
                files_bundle = data.get('files')
                if files_bundle and isinstance(files_bundle, dict):
                    bundle_str = json.dumps(files_bundle)
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("INSERT INTO configuracio (clau, valor) VALUES ('wa_auth_bundle', ?) ON CONFLICT(clau) DO UPDATE SET valor = excluded.valor", (bundle_str,))
                        conn.commit()
                    sync_to_google_sheets_async('save_config', {'wa_auth_bundle': bundle_str})
                    self.send_json({'ok': True, 'saved': len(files_bundle)})
                else:
                    self.send_json({'ok': False, 'error': 'No files provided'}, 400)
                return

            elif path == '/api/whatsapp/sync':
                sync_res = sync_whapi_inbound_messages()
                self.send_json(sync_res, 200 if sync_res.get('ok') else 500)
                return

            elif path == '/api/whatsapp/test':
                tel = (data.get('telefon') or data.get('phone') or '').strip()
                test_msg = data.get('missatge') or data.get('message') or f"Hola! Aquest és un missatge de prova de WhatsApp enviat automàticament des del Taller de Ceràmica Roig de Coure."
                test_res_id = data.get('res_id') or data.get('id') or 'TEST-1'
                res = send_whatsapp_gateway(tel, test_msg, res_id=test_res_id, include_buttons=True, send_logo=True)
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

            elif path in ('/api/activitats-info', '/api/info-activitats'):
                if not require_owner(self, data):
                    return
                info_data = data.get('info') or data
                val_str = json.dumps(info_data, ensure_ascii=False)
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('activitats_info_web', ?)", (val_str,))
                    conn.commit()
                self.send_json({'ok': True, 'message': "Informació d'activitats desada correctament", 'info': get_activitats_info_config()})
                return

            elif path == '/api/config':
                if not require_owner(self, data):
                    return
                # Desar paràmetres de configuració
                cfg_items = [(k, v) for k, v in data.items() if k not in ('owner_password_hash', 'staff_password_hash', 'admin_token', 'token')]
                with get_db() as conn:
                    cursor = conn.cursor()
                    for k, v in cfg_items:
                        cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))
                    conn.commit()

                # Sincronitzar canvis de configuració i disseny a Google Sheets
                sync_to_google_sheets_async('save_config', dict(cfg_items))

                self.send_json({'ok': True, 'message': 'Configuració actualitzada'})
                return

            elif path == '/api/festius':
                if not require_auth(self, data):
                    return
                data_inici = (data.get('data_inici') or data.get('dataInici') or '').strip()
                data_fi = (data.get('data_fi') or data.get('dataFi') or data_inici).strip()
                nom = (data.get('nom') or 'Dia de Festa').strip()
                motiu = (data.get('motiu') or '').strip()
                if not data_inici:
                    self.send_json({'ok': False, 'error': "Cal indicar la data d'inici"}, 400)
                    return
                if data_fi < data_inici:
                    data_fi = data_inici
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        INSERT INTO dies_festius (data_inici, data_fi, nom, motiu, creat_el)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (data_inici, data_fi, nom, motiu, get_now().isoformat()))
                    new_id = cursor.lastrowid
                    conn.commit()
                self.send_json({'ok': True, 'id': new_id, 'message': 'Dia de festa desat amb èxit'})
                return

            elif path in ('/api/festius/delete', '/api/festius/eliminar'):
                if not require_auth(self, data):
                    return
                festiu_id = data.get('id')
                if not festiu_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'ID del festiu"}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM dies_festius WHERE id = ?', (festiu_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Festiu eliminat'})
                return

            elif path == '/api/restriccions-activitats':
                if not require_auth(self, data):
                    return
                data_inici = (data.get('data_inici') or data.get('dataInici') or '').strip()
                data_fi = (data.get('data_fi') or data.get('dataFi') or data_inici).strip()
                tipus_abast = (data.get('tipus_abast') or data.get('tipusAbast') or 'dia').strip()
                act_perm = data.get('activitats_permeses') or data.get('activitatsPermeses') or []
                act_bloq = data.get('activitats_bloquejades') or data.get('activitatsBloquejades') or []
                motiu = (data.get('motiu') or '').strip()
                torn = (data.get('torn') or 'tot_el_dia').strip().lower()
                if torn not in ('mati', 'tarda', 'tot_el_dia'):
                    torn = 'tot_el_dia'

                if isinstance(act_perm, list):
                    act_perm_json = json.dumps(act_perm)
                else:
                    act_perm_json = str(act_perm)

                if isinstance(act_bloq, list):
                    act_bloq_json = json.dumps(act_bloq)
                else:
                    act_bloq_json = str(act_bloq)

                # Support for recurring restrictions (setmanal_dia / quinzenal_dia):
                # dates_multiples is a list of individual date strings
                dates_multiples = data.get('dates_multiples') or data.get('datesMultiples')

                if dates_multiples and isinstance(dates_multiples, list) and len(dates_multiples) > 0:
                    # Create individual rows for each date
                    new_ids = []
                    now_str = get_now().isoformat()
                    with get_db() as conn:
                        cursor = conn.cursor()
                        for d_str in dates_multiples:
                            d_str = str(d_str).strip()
                            if not d_str:
                                continue
                            cursor.execute('''
                                INSERT INTO restriccions_activitats (data_inici, data_fi, tipus_abast, activitats_permeses, activitats_bloquejades, motiu, torn, creat_el)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ''', (d_str, d_str, tipus_abast, act_perm_json, act_bloq_json, motiu, torn, now_str))
                            new_ids.append(cursor.lastrowid)
                        conn.commit()
                    self.send_json({'ok': True, 'ids': new_ids, 'count': len(new_ids), 'message': f'{len(new_ids)} restriccions de tallers desades'})
                    return

                if not data_inici:
                    self.send_json({'ok': False, 'error': "Cal indicar la data d'inici"}, 400)
                    return
                if data_fi < data_inici:
                    data_fi = data_inici

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        INSERT INTO restriccions_activitats (data_inici, data_fi, tipus_abast, activitats_permeses, activitats_bloquejades, motiu, torn, creat_el)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (data_inici, data_fi, tipus_abast, act_perm_json, act_bloq_json, motiu, torn, get_now().isoformat()))
                    new_id = cursor.lastrowid
                    conn.commit()
                self.send_json({'ok': True, 'id': new_id, 'message': 'Restricció de tallers desada'})
                return

            elif path in ('/api/restriccions-activitats/delete', '/api/restriccions-activitats/eliminar'):
                if not require_auth(self, data):
                    return
                restr_id = data.get('id')
                if not restr_id:
                    self.send_json({'ok': False, 'error': "Cal indicar l'ID de la restricció"}, 400)
                    return
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM restriccions_activitats WHERE id = ?', (restr_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Restricció eliminada'})
                return

            elif path == '/api/import':
                if not require_owner(self, data):
                    return
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

                    forbidden_import_keys = ('owner_password_hash', 'staff_password_hash', 'admin_pin')
                    for k, v in config.items():
                        if k not in forbidden_import_keys:
                            cursor.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))

                    for df in data.get('dies_festius', []):
                        cursor.execute('''
                            INSERT OR REPLACE INTO dies_festius (id, data_inici, data_fi, nom, motiu, creat_el)
                            VALUES (?, ?, ?, ?, ?, ?)
                        ''', (df.get('id'), df.get('data_inici'), df.get('data_fi'), df.get('nom'), df.get('motiu'), df.get('creat_el')))

                    for ra in data.get('restriccions_activitats', []):
                        p_str = json.dumps(ra.get('activitats_permeses', [])) if isinstance(ra.get('activitats_permeses'), list) else str(ra.get('activitats_permeses') or '')
                        b_str = json.dumps(ra.get('activitats_bloquejades', [])) if isinstance(ra.get('activitats_bloquejades'), list) else str(ra.get('activitats_bloquejades') or '')
                        cursor.execute('''
                            INSERT OR REPLACE INTO restriccions_activitats (id, data_inici, data_fi, tipus_abast, activitats_permeses, activitats_bloquejades, motiu, creat_el)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (ra.get('id'), ra.get('data_inici'), ra.get('data_fi'), ra.get('tipus_abast', 'dia'), p_str, b_str, ra.get('motiu'), ra.get('creat_el')))

                    conn.commit()

                # Després d'importar o restaurar, sincronitzar automàticament totes les dades a Google Sheets
                try:
                    with get_db() as conn_sync:
                        c_sync = conn_sync.cursor()
                        c_sync.execute('SELECT * FROM alumnes')
                        al_sync = [row_to_dict(r) for r in c_sync.fetchall()]
                        c_sync.execute('SELECT * FROM paquets_hores')
                        pk_sync = [row_to_dict(r) for r in c_sync.fetchall()]
                        c_sync.execute('SELECT * FROM sessions')
                        se_sync = [row_to_dict(r) for r in c_sync.fetchall()]
                        c_sync.execute('SELECT * FROM reserves')
                        rs_sync = [row_to_dict(r) for r in c_sync.fetchall()]
                        c_sync.execute('SELECT clau, valor FROM configuracio')
                        cf_sync = {r['clau']: r['valor'] for r in c_sync.fetchall()}
                    sync_to_google_sheets_async('sync_all', {
                        'alumnes': al_sync,
                        'paquets': pk_sync,
                        'sessions': se_sync,
                        'reserves': rs_sync,
                        'config': cf_sync
                    })
                except Exception as sync_err:
                    print(f"[Import Sync] Avís sincronitzant post-import: {sync_err}")

                self.send_json({'ok': True, 'message': 'Dades restaurades amb èxit i sincronitzades amb Google Sheets'})
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

            elif path == '/api/fornades':
                fornada_id = str(data.get('id', '')).strip() or f"forn_{get_now().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(3)}"
                data_forn = str(data.get('data', '')).strip() or get_now().strftime('%Y-%m-%d')
                titol = str(data.get('titol', '')).strip() or 'Nova Fornada'
                descripcio = str(data.get('descripcio', '')).strip()
                video_url = str(data.get('video_url', '')).strip()
                estat = str(data.get('estat', 'oberta')).strip()
                now_iso = get_now().isoformat()

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        INSERT INTO fornades (id, data, titol, descripcio, video_url, estat, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            data = excluded.data,
                            titol = excluded.titol,
                            descripcio = excluded.descripcio,
                            video_url = excluded.video_url,
                            estat = excluded.estat
                    ''', (fornada_id, data_forn, titol, descripcio, video_url, estat, now_iso))
                    conn.commit()

                self.send_json({'ok': True, 'message': 'Fornada desada correctament', 'id': fornada_id})
                return

            elif path.startswith('/api/alumnes/') and path.endswith('/peces'):
                parts = path.strip('/').split('/')
                student_id = urllib.parse.unquote(parts[2]) if len(parts) > 2 else ''
                nom_peca = str(data.get('nom', '')).strip()
                if not nom_peca:
                    self.send_json({'ok': False, 'error': 'Cal indicar un nom o descripció per a la peça'}, 400)
                    return

                tecnica = str(data.get('tecnica', 'torn')).strip()
                raw_foto = data.get('foto_cru', '')
                foto_cru_path = save_uploaded_piece_image(raw_foto, prefix="peca_cru") if raw_foto else ""
                notes = str(data.get('notes', '')).strip()
                now_iso = get_now().isoformat()
                peca_id = f"peca_{get_now().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(4)}"

                with get_db() as conn:
                    cursor = conn.cursor()
                    student = find_student_by_code(cursor, student_id, actiu_only=False)
                    real_id = student['id'] if student else student_id

                    cursor.execute('''
                        INSERT INTO peces_alumne (id, student_id, fornada_id, nom, tecnica, foto_cru, foto_cuit, estat, avis_recollida, notes, created_at, updated_at)
                        VALUES (?, ?, NULL, ?, ?, ?, '', 'assecat', 0, ?, ?, ?)
                    ''', (peca_id, real_id, nom_peca, tecnica, foto_cru_path, notes, now_iso, now_iso))
                    conn.commit()

                self.send_json({'ok': True, 'message': 'Peça registrada correctament', 'id': peca_id, 'foto_cru': foto_cru_path})
                return

            elif path.startswith('/api/peces/') and path.endswith('/foto_cuit'):
                parts = path.strip('/').split('/')
                peca_id = urllib.parse.unquote(parts[2])
                raw_foto = data.get('foto_cuit', '')
                foto_cuit_path = save_uploaded_piece_image(raw_foto, prefix="peca_cuit") if raw_foto else ""
                now_iso = get_now().isoformat()

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        UPDATE peces_alumne
                        SET foto_cuit = ?, updated_at = ?
                        WHERE id = ?
                    ''', (foto_cuit_path, now_iso, peca_id))
                    conn.commit()

                self.send_json({'ok': True, 'message': 'Foto cuita desada correctament', 'foto_cuit': foto_cuit_path})
                return

            elif path.startswith('/api/peces/') and path.endswith('/recollida'):
                parts = path.strip('/').split('/')
                peca_id = urllib.parse.unquote(parts[2])
                now_iso = get_now().isoformat()

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        UPDATE peces_alumne
                        SET avis_recollida = 1, data_recollida = ?, estat = CASE WHEN estat IN ('assecat', 'bescuit') THEN 'llest_recollir' ELSE estat END, updated_at = ?
                        WHERE id = ?
                    ''', (now_iso, now_iso, peca_id))
                    conn.commit()

                self.send_json({'ok': True, 'message': "Notificació de recollida enviada al taller!"})
                return

            elif path.startswith('/api/peces/') and path.endswith('/lliurada'):
                parts = path.strip('/').split('/')
                peca_id = urllib.parse.unquote(parts[2])
                now_iso = get_now().isoformat()

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        UPDATE peces_alumne
                        SET estat = 'lliurada', avis_recollida = 0, updated_at = ?
                        WHERE id = ?
                    ''', (now_iso, peca_id))
                    conn.commit()

                self.send_json({'ok': True, 'message': "Peça marcada com a lliurada a l'alumne."})
                return

            elif path.startswith('/api/peces/'):
                peca_id = path.replace('/api/peces/', '').strip()
                now_iso = get_now().isoformat()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM peces_alumne WHERE id = ?', (peca_id,))
                    existing = cursor.fetchone()
                    if not existing:
                        self.send_json({'ok': False, 'error': 'Peça no trobada'}, 404)
                        return

                    nom = str(data.get('nom', existing['nom'])).strip()
                    tecnica = str(data.get('tecnica', existing['tecnica'])).strip()
                    estat = str(data.get('estat', existing['estat'])).strip()
                    fornada_id = data.get('fornada_id', existing['fornada_id'])
                    notes = str(data.get('notes', existing['notes'] or '')).strip()

                    cursor.execute('''
                        UPDATE peces_alumne
                        SET nom = ?, tecnica = ?, estat = ?, fornada_id = ?, notes = ?, updated_at = ?
                        WHERE id = ?
                    ''', (nom, tecnica, estat, fornada_id, notes, now_iso, peca_id))
                    conn.commit()

                self.send_json({'ok': True, 'message': 'Peça actualitzada correctament'})
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

                res_dict = row_to_dict(row) if row else None
                if res_dict:
                    cal_name = 'reserves'
                    with get_db() as conn2:
                        c2 = conn2.cursor()
                        c2.execute("SELECT valor FROM configuracio WHERE clau = 'google_calendar_name'")
                        cr = c2.fetchone()
                        if cr and cr['valor']:
                            cal_name = cr['valor']
                    res_dict['calendar_name'] = cal_name
                    sync_to_google_sheets_async('delete_reserva', res_dict)
                else:
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

            elif path.startswith('/api/festius/'):
                if not require_auth(self):
                    return
                festiu_id = path.replace('/api/festius/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM dies_festius WHERE id = ?', (festiu_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Festiu eliminat'})
                return

            elif path.startswith('/api/restriccions-activitats/'):
                if not require_auth(self):
                    return
                restr_id = path.replace('/api/restriccions-activitats/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM restriccions_activitats WHERE id = ?', (restr_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Restricció eliminada'})
                return

            elif path.startswith('/api/activitats/'):
                act_id = path.replace('/api/activitats/', '').strip().lower()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM activitats WHERE id = ?', (act_id,))
                    existing = cursor.fetchone()
                    if not existing:
                        self.send_json({'ok': False, 'error': f"No s'ha trobat el taller '{act_id}'"}, 404)
                        return

                    cursor.execute('''
                        SELECT COUNT(*) as cnt FROM reserves 
                        WHERE (LOWER(activitat_id) = ? OR LOWER(activitat) = ?) 
                        AND LOWER(estat) NOT LIKE 'cancel%' AND LOWER(estat) != 'eliminada'
                    ''', (act_id, existing['nom'].lower()))
                    res_cnt = cursor.fetchone()['cnt']

                    if res_cnt > 0 or act_id in ('torn', 'modelatge', 'pintar'):
                        cursor.execute('UPDATE activitats SET actiu = 0 WHERE id = ?', (act_id,))
                        conn.commit()
                        action = 'desactivat'
                        msg = f"El taller '{existing['nom']}' té reserves associades o és un taller principal; s'ha desactivat per mantenir l'historial."
                    else:
                        cursor.execute('DELETE FROM activitats WHERE id = ?', (act_id,))
                        conn.commit()
                        action = 'eliminat'
                        msg = f"El taller '{existing['nom']}' s'ha eliminat correctament."

                all_acts = get_activitats_config(include_inactive=True)
                self.send_json({
                    'ok': True,
                    'action': action,
                    'message': msg,
                    'activitats': all_acts
                })
                return

            elif path.startswith('/api/articles/'):
                art_id = path.replace('/api/articles/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM articles WHERE id = ?', (art_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Article eliminat correctament del catàleg'})
                return

            elif path.startswith('/api/peces/'):
                peca_id = path.replace('/api/peces/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM peces_alumne WHERE id = ?', (peca_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Peça eliminada correctament'})
                return

            elif path.startswith('/api/fornades/'):
                fornada_id = path.replace('/api/fornades/', '').strip()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM fornades WHERE id = ?', (fornada_id,))
                    cursor.execute('UPDATE peces_alumne SET fornada_id = NULL WHERE fornada_id = ?', (fornada_id,))
                    conn.commit()
                self.send_json({'ok': True, 'message': 'Fornada eliminada correctament'})
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
        s.settimeout(1)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print("=" * 65)
    print("SERVIDOR DEL TALLER DE CERAMICA ACTIU (SQLite + REST API)")
    print("=" * 65)
    print(f"Local (aquest ordinador):   http://localhost:{PORT}")
    print(f"Mobil / Tauleta (WiFi):     http://{local_ip}:{PORT}")
    print(f"Panell Administracio:       http://localhost:{PORT}/admin.html")
    print(f"Botiga & Vals Regal:        http://localhost:{PORT}/botiga.html")
    print(f"Reserves Web:               http://localhost:{PORT}/reserva.html")
    print(f"Escaner QR:                 http://localhost:{PORT}/scanner.html")
    print(f"Portal Alumne:              http://localhost:{PORT}/alumne.html")
    print(f"Base de Dades SQLite:       {DB_PATH}")
    print("=" * 65)
    print("Prem Ctrl+C per aturar el servidor.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nAturant servidor...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()


