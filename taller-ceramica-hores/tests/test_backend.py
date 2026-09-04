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
            'brand_primary': '#C25E3A',
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
        self.assertEqual(cfg.get('brand_primary'), '#C25E3A')
        self.assertEqual(cfg.get('brand_secondary'), '#5E7E6F')
        self.assertEqual(cfg.get('brand_font'), 'serif')
        self.assertEqual(cfg.get('taller_logo_url'), 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')

if __name__ == '__main__':
    unittest.main()
