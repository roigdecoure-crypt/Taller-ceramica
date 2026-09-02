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

if __name__ == '__main__':
    unittest.main()
