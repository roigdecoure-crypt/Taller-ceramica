#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_backend.py - Proves unitàries i d'integració per a les funcionalitats clau
"""

import os
import sys
import unittest
import sqlite3
import json
from datetime import datetime, timedelta

# Afegir directori arrel al path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

class TestCeramicsBackend(unittest.TestCase):
    def setUp(self):
        server.init_db()
        self.conn = server.get_db()

    def tearDown(self):
        self.conn.close()

    def test_01_format_hms(self):
        self.assertEqual(server.format_hms(0), "00:00:00")
        self.assertEqual(server.format_hms(59), "00:00:59")
        self.assertEqual(server.format_hms(60), "00:01:00")
        self.assertEqual(server.format_hms(3600), "01:00:00")
        self.assertEqual(server.format_hms(3661), "01:01:01")
        self.assertEqual(server.format_hms(5400), "01:30:00")
        self.assertEqual(server.format_hms(86400), "24:00:00")
        self.assertEqual(server.format_hms(-3600), "-01:00:00")

    def test_02_student_creation_and_balance(self):
        # Crear alumne de prova
        c = self.conn.cursor()
        test_id = "TC-TEST-99"
        c.execute("DELETE FROM sessions WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM paquets_hores WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM alumnes WHERE id = ?", (test_id,))
        
        c.execute('''
            INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, actiu)
            VALUES (?, 'Alumne', 'De Prova', '600000000', 'prova@test.com', '9999', ?, 1)
        ''', (test_id, datetime.now().isoformat()))

        # Afegir paquet de 10 hores = 36000 segons
        c.execute('''
            INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament)
            VALUES ('PK-TEST-1', ?, ?, 10.0, 36000, 'Pack 10 Hores Test', 120.0, 'Stripe')
        ''', (test_id, datetime.now().isoformat()))
        self.conn.commit()

        bal = server.get_student_balance(test_id)
        self.assertEqual(bal['totalBoughtSeconds'], 36000)
        self.assertEqual(bal['totalSpentSeconds'], 0)
        self.assertEqual(bal['balanceSeconds'], 36000)
        self.assertEqual(bal['formatBalance'], "10:00:00")

    def test_03_checkin_checkout_flow(self):
        test_id = "TC-TEST-99"
        c = self.conn.cursor()

        # Simular sessió de 1h 15m 30s (4530 segons)
        entrada_dt = datetime.now() - timedelta(seconds=4530)
        sortida_dt = datetime.now()
        durada_segons = 4530
        durada_hms = server.format_hms(durada_segons)

        c.execute('''
            INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat)
            VALUES ('SES-TEST-1', ?, ?, ?, ?, ?, ?, 'qr', 'tancada')
        ''', (test_id, entrada_dt.strftime('%Y-%m-%d'), entrada_dt.isoformat(), sortida_dt.isoformat(), durada_segons, durada_hms))
        self.conn.commit()

        bal = server.get_student_balance(test_id)
        # 36000 - 4530 = 31470 segons = 08:44:30
        self.assertEqual(bal['totalSpentSeconds'], 4530)
        self.assertEqual(bal['balanceSeconds'], 31470)
        self.assertEqual(bal['formatBalance'], "08:44:30")
        self.assertEqual(bal['formatSpent'], "01:15:30")

    def test_04_force_close_forgotten_cycle(self):
        test_id = "TC-TEST-99"
        c = self.conn.cursor()

        # Crear sessió oberta que l'alumne va oblidar de tancar fa 4 hores
        entrada_dt = datetime.now() - timedelta(hours=4)
        c.execute('''
            INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat)
            VALUES ('SES-TEST-FORGOT', ?, ?, ?, NULL, 0, '00:00:00', 'qr', 'oberta')
        ''', (test_id, entrada_dt.strftime('%Y-%m-%d'), entrada_dt.isoformat()))
        self.conn.commit()

        # Comprovar que la sessió oberta no s'ha descomptat encara
        bal_before = server.get_student_balance(test_id)
        self.assertEqual(bal_before['totalSpentSeconds'], 4530)

        # Forçar tancament aplicant durada estàndard del taller (1h 30m = 5400 segons)
        durada_estandar = 5400
        durada_hms = server.format_hms(durada_estandar)
        sortida_dt = entrada_dt + timedelta(seconds=durada_estandar)

        c.execute('''
            UPDATE sessions
            SET sortida = ?, durada_segons = ?, format_hms = ?, estat = 'tancada_forçada', notes = 'Tancat per oblit'
            WHERE id = 'SES-TEST-FORGOT'
        ''', (sortida_dt.isoformat(), durada_estandar, durada_hms))
        self.conn.commit()

        bal_after = server.get_student_balance(test_id)
        # Total gastat: 4530 + 5400 = 9930 segons = 02:45:30
        # Saldo restant: 36000 - 9930 = 26070 segons = 07:14:30
        self.assertEqual(bal_after['totalSpentSeconds'], 9930)
        self.assertEqual(bal_after['formatSpent'], "02:45:30")
        self.assertEqual(bal_after['balanceSeconds'], 26070)
        self.assertEqual(bal_after['formatBalance'], "07:14:30")

        # Neteja de les dades de prova
        c.execute("DELETE FROM sessions WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM paquets_hores WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM alumnes WHERE id = ?", (test_id,))
        self.conn.commit()

    def test_05_manual_action_and_custom_time(self):
        test_id = "TC-TEST-MANUAL"
        c = self.conn.cursor()
        c.execute("DELETE FROM sessions WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM paquets_hores WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM alumnes WHERE id = ?", (test_id,))

        c.execute('''
            INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, actiu)
            VALUES (?, 'Test', 'Manual', '611111111', 'manual@test.com', '1234', ?, 1)
        ''', (test_id, datetime.now().isoformat()))
        c.execute('''
            INSERT INTO paquets_hores (id, student_id, data, hores, segons, concepte, preu, metode_pagament)
            VALUES ('PK-MANUAL-1', ?, ?, 5.0, 18000, 'Pack 5h', 65.0, 'Efectiu')
        ''', (test_id, datetime.now().isoformat()))
        self.conn.commit()

        # Simular entrada manual a les 10:00:00
        t_in = datetime(2026, 9, 3, 10, 0, 0)
        c.execute('''
            INSERT INTO sessions (id, student_id, data, entrada, sortida, durada_segons, format_hms, tipus, estat)
            VALUES ('SES-MAN-1', ?, '2026-09-03', ?, NULL, 0, '00:00:00', 'manual', 'oberta')
        ''', (test_id, t_in.isoformat()))
        self.conn.commit()

        # Simular sortida manual a les 11:30:15 (durada = 1h 30m 15s = 5415s)
        t_out = datetime(2026, 9, 3, 11, 30, 15)
        diff_sec = int((t_out - t_in).total_seconds())
        diff_hms = server.format_hms(diff_sec)
        self.assertEqual(diff_sec, 5415)
        self.assertEqual(diff_hms, "01:30:15")

        c.execute('''
            UPDATE sessions
            SET sortida = ?, durada_segons = ?, format_hms = ?, estat = 'tancada', tipus = 'manual'
            WHERE id = 'SES-MAN-1'
        ''', (t_out.isoformat(), diff_sec, diff_hms))
        self.conn.commit()

        bal = server.get_student_balance(test_id)
        self.assertEqual(bal['totalSpentSeconds'], 5415)
        self.assertEqual(bal['formatSpent'], "01:30:15")
        # 18000 - 5415 = 12585 segons = 03:29:45
        self.assertEqual(bal['balanceSeconds'], 12585)
        self.assertEqual(bal['formatBalance'], "03:29:45")

        # Neteja
        c.execute("DELETE FROM sessions WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM paquets_hores WHERE student_id = ?", (test_id,))
        c.execute("DELETE FROM alumnes WHERE id = ?", (test_id,))
        self.conn.commit()

    def test_06_hydration_logic(self):
        from unittest.mock import patch, MagicMock
        import io

        mock_payload = {
            "status": "success",
            "data": {
                "alumnes": [
                    {
                        "id": "TC-HYD-1",
                        "nom": "Aina",
                        "cognoms": "Serra",
                        "telefon": "644111222",
                        "email": "aina@taller.cat",
                        "pin": "2001",
                        "data_alta": "2026-09-01T10:00:00",
                        "notes": "Alumna hidratada",
                        "actiu": 1
                    }
                ],
                "paquets": [
                    {
                        "id": "PK-HYD-1",
                        "student_id": "TC-HYD-1",
                        "data": "2026-09-01T10:05:00",
                        "hores": 15.0,
                        "segons": 54000,
                        "concepte": "Pack 15h Hidratat",
                        "preu": 180.0,
                        "metode_pagament": "Stripe",
                        "notes": ""
                    }
                ],
                "sessions": [
                    {
                        "id": "SES-HYD-1",
                        "student_id": "TC-HYD-1",
                        "data": "2026-09-02",
                        "entrada": "2026-09-02T10:00:00",
                        "sortida": "2026-09-02T12:00:00",
                        "durada_segons": 7200,
                        "format_hms": "02:00:00",
                        "tipus": "qr",
                        "estat": "tancada",
                        "notes": "Classe completada"
                    }
                ],
                "config": {
                    "taller_nom": "Taller Ceràmica Test Hidratat"
                }
            }
        }

        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = json.dumps(mock_payload).encode('utf-8')

        with patch('urllib.request.OpenerDirector.open', return_value=mock_resp):
            res = server.hydrate_from_google_sheets("https://script.google.com/macros/s/mock/exec")
            self.assertTrue(res['ok'])
            self.assertEqual(res['counts']['alumnes'], 1)
            self.assertEqual(res['counts']['paquets'], 1)
            self.assertEqual(res['counts']['sessions'], 1)

        # Comprovar que s'han desat a SQLite
        c = self.conn.cursor()
        c.execute("SELECT * FROM alumnes WHERE id = 'TC-HYD-1'")
        st = server.row_to_dict(c.fetchone())
        self.assertIsNotNone(st)
        self.assertEqual(st['nom'], "Aina")

        # Comprovar càlcul de saldo hidratat (15h - 2h = 13h = 46800s)
        bal = server.get_student_balance("TC-HYD-1")
        self.assertEqual(bal['totalBoughtSeconds'], 54000)
        self.assertEqual(bal['totalSpentSeconds'], 7200)
        self.assertEqual(bal['balanceSeconds'], 46800)
        self.assertEqual(bal['formatBalance'], "13:00:00")

        # Neteja
        c.execute("DELETE FROM sessions WHERE student_id = 'TC-HYD-1'")
        c.execute("DELETE FROM paquets_hores WHERE student_id = 'TC-HYD-1'")
        c.execute("DELETE FROM alumnes WHERE id = 'TC-HYD-1'")
        self.conn.commit()

    def test_07_brand_configuration(self):
        c = self.conn.cursor()
        brand_data = {
            'taller_nom': 'Roig de Coure Prova',
            'taller_subtitol': 'Taller d\'Art i Modelat',
            'brand_primary': '#831D1D',
            'brand_secondary': '#5E7E6F',
            'brand_font': 'serif',
            'brand_palette': 'roigdecoure',
            'taller_logo_url': 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
        }

        for k, v in brand_data.items():
            c.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', (k, str(v)))
        self.conn.commit()

        c.execute('SELECT clau, valor FROM configuracio')
        cfg_rows = c.fetchall()
        cfg = {r['clau']: r['valor'] for r in cfg_rows}

        self.assertEqual(cfg.get('taller_nom'), 'Roig de Coure Prova')
        self.assertEqual(cfg.get('taller_subtitol'), 'Taller d\'Art i Modelat')
        self.assertEqual(cfg.get('brand_primary'), '#831D1D')
        self.assertEqual(cfg.get('brand_secondary'), '#5E7E6F')
        self.assertEqual(cfg.get('brand_font'), 'serif')
        self.assertEqual(cfg.get('taller_logo_url'), 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')

    def test_08_reserves_and_capacity(self):
        c = self.conn.cursor()
        test_student = 'TC-RES-TEST'
        c.execute("DELETE FROM reserves WHERE student_id = ?", (test_student,))
        c.execute("DELETE FROM alumnes WHERE id = ?", (test_student,))
        c.execute('''
            INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, actiu)
            VALUES (?, 'Alumne', 'Reserves', '611223344', 'reserves@test.com', '1234', ?, 1)
        ''', (test_student, datetime.now().isoformat()))

        # Configurar aforament màxim a 2 per provar el límit
        c.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', ('aforament_maxim_per_franja', '2'))
        self.conn.commit()

        test_data = '2026-09-10' # Dijous (obert)
        slot_id = 'F1'
        c.execute("DELETE FROM reserves WHERE data = ?", (test_data,))
        self.conn.commit()

        # Comprovar disponibilitat inicial
        disp = server.get_disponibilitat(test_data)
        self.assertFalse(disp['tancat'])
        franja = next(f for f in disp['franges'] if f['id'] == slot_id)
        self.assertEqual(franja['totalPlaces'], 2)
        self.assertEqual(franja['placesLliures'], 2)
        self.assertEqual(franja['estat'], 'lliure')

        # Crear 1a reserva (Torn)
        res_id_1 = "RES-T1"
        c.execute('''
            INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, estat, hores, notes, created_at)
            VALUES (?, ?, 'Alumne 1', ?, '10:00', '11:30', ?, 'Torn', 'torn', 1, 'confirmada', 1.5, '', ?)
        ''', (res_id_1, test_student, test_data, slot_id, datetime.now().isoformat()))
        self.conn.commit()

        disp = server.get_disponibilitat(test_data)
        franja = next(f for f in disp['franges'] if f['id'] == slot_id)
        self.assertEqual(franja['placesOcupades'], 1)
        self.assertEqual(franja['placesLliures'], 1)
        self.assertEqual(franja['estat'], 'ultimes_places')

        # Crear 2a reserva (assolir límit d'aforament de 2)
        res_id_2 = "RES-T2"
        c.execute('''
            INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, estat, hores, notes, created_at)
            VALUES (?, 'TC-102', 'Alumne 2', ?, '10:00', '11:30', ?, 'Modelatge', 'modelatge', 1, 'confirmada', 1.5, '', ?)
        ''', (res_id_2, test_data, slot_id, datetime.now().isoformat()))
        self.conn.commit()

        disp = server.get_disponibilitat(test_data)
        franja = next(f for f in disp['franges'] if f['id'] == slot_id)
        self.assertEqual(franja['placesOcupades'], 2)
        self.assertEqual(franja['placesLliures'], 0)
        self.assertEqual(franja['estat'], 'complet')

        # Cancel·lar 1a reserva i comprovar alliberament de plaça
        c.execute("UPDATE reserves SET estat = 'cancel·lada' WHERE id = ?", (res_id_1,))
        self.conn.commit()

        disp = server.get_disponibilitat(test_data)
        franja = next(f for f in disp['franges'] if f['id'] == slot_id)
        self.assertEqual(franja['placesOcupades'], 1)
        self.assertEqual(franja['placesLliures'], 1)

        # Provar disponibilitat de mes
        disp_mes = server.get_disponibilitat_mes(2026, 9)
        self.assertIn('2026-09-10', disp_mes['dies'])
        self.assertFalse(disp_mes['dies']['2026-09-10']['tancat'])
        # Dilluns 7 ha d'estar tancat
        self.assertTrue(disp_mes['dies']['2026-09-07']['tancat'])

        # Neteja
        c.execute("DELETE FROM reserves WHERE id IN (?, ?)", (res_id_1, res_id_2))
        c.execute("DELETE FROM alumnes WHERE id = ?", (test_student,))
        c.execute('INSERT OR REPLACE INTO configuracio (clau, valor) VALUES (?, ?)', ('aforament_maxim_per_franja', '12'))
        self.conn.commit()

        # Comprovar capacitats oficials: Torn 4, Modelatge 8, Pintar 12, Total Franja 12
        disp_12 = server.get_disponibilitat('2026-09-12')
        franja_12 = next(f for f in disp_12['franges'] if f['id'] == 'F1')
        self.assertEqual(franja_12['totalPlaces'], 12)
        act_map = {a['id']: a for a in franja_12['activitats']}
        self.assertEqual(len(act_map), 3)
        self.assertEqual(act_map['torn']['capacitatMax'], 4)
        self.assertEqual(act_map['modelatge']['capacitatMax'], 8)
        self.assertEqual(act_map['pintar']['capacitatMax'], 12)

    def test_09_edat_and_stripe_config(self):
        c = self.conn.cursor()
        test_id_adult = "TC-TEST-ADULT"
        test_id_nen = "TC-TEST-NEN"
        c.execute("DELETE FROM alumnes WHERE id IN (?, ?)", (test_id_adult, test_id_nen))
        c.execute('''
            INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu, edat)
            VALUES (?, 'Adult', 'Test', '600000001', 'adult@test.com', '1234', ?, '', 1, 35)
        ''', (test_id_adult, datetime.now().isoformat()))
        c.execute('''
            INSERT INTO alumnes (id, nom, cognoms, telefon, email, pin, data_alta, notes, actiu, edat)
            VALUES (?, 'Nen', 'Test', '600000002', 'nen@test.com', '1235', ?, '', 1, 9)
        ''', (test_id_nen, datetime.now().isoformat()))
        self.conn.commit()

        c.execute("SELECT edat FROM alumnes WHERE id = ?", (test_id_adult,))
        self.assertEqual(c.fetchone()['edat'], 35)
        c.execute("SELECT edat FROM alumnes WHERE id = ?", (test_id_nen,))
        self.assertEqual(c.fetchone()['edat'], 9)

        # Provar configuració de tall i urls
        c.execute("SELECT valor FROM configuracio WHERE clau = 'edat_tall_infantil'")
        row = c.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row['valor'], '12')

        # Neteja
        c.execute("DELETE FROM alumnes WHERE id IN (?, ?)", (test_id_adult, test_id_nen))
        self.conn.commit()

    def test_10_google_calendar_config_and_event_id(self):
        c = self.conn.cursor()
        c.execute("SELECT valor FROM configuracio WHERE clau = 'google_calendar_name'")
        row = c.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row['valor'], 'roigdecoure')

        # Comprovar inserció i lectura de calendar_event_id a reserves
        test_res_id = "RES-TEST-CAL"
        test_student = "TC-101"
        c.execute("DELETE FROM reserves WHERE id = ?", (test_res_id,))
        c.execute('''
            INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, estat, hores, notes, created_at, calendar_event_id)
            VALUES (?, ?, 'Test Cal', '2026-09-15', '10:00', '11:30', 'F1', 'Torn', 'torn', 1, '600000000', 'confirmada', 1.5, '', ?, 'cal_event_12345')
        ''', (test_res_id, test_student, datetime.now().isoformat()))
        self.conn.commit()

        c.execute("SELECT calendar_event_id FROM reserves WHERE id = ?", (test_res_id,))
        row = c.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row['calendar_event_id'], 'cal_event_12345')

        # Neteja
        c.execute("DELETE FROM reserves WHERE id = ?", (test_res_id,))
        self.conn.commit()

    def test_11_activitats_custom_capacities(self):
        # Comprovar configuració per defecte
        acts = server.get_activitats_config()
        self.assertEqual(len(acts), 3)
        act_map = {a['id']: a['capacitatMax'] for a in acts}
        self.assertEqual(act_map['torn'], 4)
        self.assertEqual(act_map['modelatge'], 8)
        self.assertEqual(act_map['pintar'], 12)

        # Modificar capacitats des de la configuració
        c = self.conn.cursor()
        c.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('capacitat_max_torn', '6')")
        c.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('capacitat_max_modelatge', '10')")
        c.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('capacitat_max_pintar', '14')")
        self.conn.commit()

        acts_mod = server.get_activitats_config()
        act_mod_map = {a['id']: a['capacitatMax'] for a in acts_mod}
        self.assertEqual(act_mod_map['torn'], 6)
        self.assertEqual(act_mod_map['modelatge'], 10)
        self.assertEqual(act_mod_map['pintar'], 14)

        # Restaurar valors originals
        c.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('capacitat_max_torn', '4')")
        c.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('capacitat_max_modelatge', '8')")
        c.execute("INSERT OR REPLACE INTO configuracio (clau, valor) VALUES ('capacitat_max_pintar', '12')")
        self.conn.commit()

    def test_12_non_student_public_booking_and_whatsapp_flags(self):
        c = self.conn.cursor()
        cli_res_id = "RES-CLI-TEST-1"
        c.execute("DELETE FROM reserves WHERE id = ?", (cli_res_id,))

        # Inserir reserva d'un client públic (no alumne registrat)
        c.execute('''
            INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, email, estat, hores, notes, created_at)
            VALUES (?, 'CLI-1725500000', 'Maria Garcia', '2026-09-18', '17:00', '18:30', 'F3', 'Pintar ceràmica', 'pintar', 2, '+34611223344', 'maria@gmail.com', 'confirmada', 1.5, 'Reserva des de web Elementor', ?)
        ''', (cli_res_id, datetime.now().isoformat()))
        self.conn.commit()

        c.execute("SELECT student_id, student_nom, telefon, email, places, whatsapp_notif_confirm, whatsapp_notif_48h, whatsapp_notif_dia FROM reserves WHERE id = ?", (cli_res_id,))
        row = c.fetchone()
        self.assertIsNotNone(row)
        self.assertTrue(row['student_id'].startswith('CLI-'))
        self.assertEqual(row['student_nom'], 'Maria Garcia')
        self.assertEqual(row['telefon'], '+34611223344')
        self.assertEqual(row['email'], 'maria@gmail.com')
        self.assertEqual(row['places'], 2)
        # Els camps de WhatsApp han d'estar inicialitzats
        self.assertIn(row['whatsapp_notif_confirm'], (None, 0))

        # Neteja
        c.execute("DELETE FROM reserves WHERE id = ?", (cli_res_id,))
        self.conn.commit()

    def test_13_whatsapp_meta_cloud_api_format(self):
        # Validar funcionament de send_whatsapp_meta quan no està configurat
        res_no_config = server.send_whatsapp_meta("611223344", "reserva_confirmada", ["Joan", "Torn", "2026-09-15", "10:00", "1"])
        self.assertFalse(res_no_config['ok'])
        self.assertIn('activat', res_no_config['error'].lower())

    def test_14_reserva_assistencia_attendance(self):
        c = self.conn.cursor()
        test_res_id = "RES-ATTEND-TEST-1"
        c.execute("DELETE FROM reserves WHERE id = ?", (test_res_id,))
        c.execute('''
            INSERT INTO reserves (id, student_id, student_nom, data, hora_inici, hora_fi, franja, activitat, activitat_id, places, telefon, email, estat, hores, notes, created_at)
            VALUES (?, 'TC-101', 'Alumne Test', '2026-09-20', '10:00', '11:30', 'F1', 'Torn', 'torn', 1, '+34600000000', 'test@test.com', 'confirmada', 1.5, 'Test Assistència', ?)
        ''', (test_res_id, datetime.now().isoformat()))
        self.conn.commit()

        # Comprovar estat inicial confirmada
        c.execute("SELECT estat FROM reserves WHERE id = ?", (test_res_id,))
        row = c.fetchone()
        self.assertEqual(row['estat'], 'confirmada')

        # Canviar a assistit
        c.execute("UPDATE reserves SET estat = 'assistit' WHERE id = ?", (test_res_id,))
        self.conn.commit()
        c.execute("SELECT estat FROM reserves WHERE id = ?", (test_res_id,))
        self.assertEqual(c.fetchone()['estat'], 'assistit')

        # Neteja
        c.execute("DELETE FROM reserves WHERE id = ?", (test_res_id,))
        self.conn.commit()

if __name__ == '__main__':
    unittest.main()

