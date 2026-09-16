import unittest
import json
import os
import urllib.request
import urllib.parse
from server import (
    get_db, init_db, get_now,
    calcular_preu_hores_trams,
    get_restriccions_dia,
    get_disponibilitat
)

class TestNewProposalsAndSquare(unittest.TestCase):

    def setUp(self):
        init_db()

    def test_01_calcular_preu_hores_adults(self):
        # 1h a 3h: 18€/h
        h, p, tot, _ = calcular_preu_hores_trams(1, es_infant=False)
        self.assertEqual(p, 18.0)
        self.assertEqual(tot, 18.0)

        h, p, tot, _ = calcular_preu_hores_trams(3, es_infant=False)
        self.assertEqual(p, 18.0)
        self.assertEqual(tot, 54.0)

        # 4h a 9h: 15€/h
        h, p, tot, _ = calcular_preu_hores_trams(4, es_infant=False)
        self.assertEqual(p, 15.0)
        self.assertEqual(tot, 60.0)

        h, p, tot, _ = calcular_preu_hores_trams(9, es_infant=False)
        self.assertEqual(p, 15.0)
        self.assertEqual(tot, 135.0)

        # 10h a 19h: 14€/h
        h, p, tot, _ = calcular_preu_hores_trams(10, es_infant=False)
        self.assertEqual(p, 14.0)
        self.assertEqual(tot, 140.0)

        h, p, tot, _ = calcular_preu_hores_trams(15, es_infant=False)
        self.assertEqual(p, 14.0)
        self.assertEqual(tot, 210.0)

        # 20h o més: 13€/h
        h, p, tot, _ = calcular_preu_hores_trams(20, es_infant=False)
        self.assertEqual(p, 13.0)
        self.assertEqual(tot, 260.0)

        h, p, tot, _ = calcular_preu_hores_trams(25, es_infant=False)
        self.assertEqual(p, 13.0)
        self.assertEqual(tot, 325.0)

    def test_02_calcular_preu_hores_infants(self):
        # 1h a 3h: 15€/h
        h, p, tot, _ = calcular_preu_hores_trams(2, es_infant=True)
        self.assertEqual(p, 15.0)
        self.assertEqual(tot, 30.0)

        # 4h a 9h: 14€/h
        h, p, tot, _ = calcular_preu_hores_trams(5, es_infant=True)
        self.assertEqual(p, 14.0)
        self.assertEqual(tot, 70.0)

        # 10h a 19h: 13€/h
        h, p, tot, _ = calcular_preu_hores_trams(10, es_infant=True)
        self.assertEqual(p, 13.0)
        self.assertEqual(tot, 130.0)

        # 20h o més: 11€/h
        h, p, tot, _ = calcular_preu_hores_trams(20, es_infant=True)
        self.assertEqual(p, 11.0)
        self.assertEqual(tot, 220.0)

    def test_03_restriccions_per_torn(self):
        data_test = "2026-11-20"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM restriccions_activitats WHERE data_inici = ?", (data_test,))
            # Bloquejar torn només al matí
            cursor.execute("""
                INSERT INTO restriccions_activitats 
                (data_inici, data_fi, tipus_abast, activitats_permeses, activitats_bloquejades, motiu, torn, creat_el)
                VALUES (?, ?, 'dia', '["modelatge", "pintar"]', '["torn"]', 'Monogràfic matí', 'mati', '2026-09-15')
            """, (data_test, data_test))
            conn.commit()

        # Comprovació al matí: torn ha d'estar bloquejat
        restr_mati = get_restriccions_dia(data_test, torn_filtre='mati')
        self.assertTrue(restr_mati['te_restriccio'])
        self.assertIn('torn', restr_mati['bloquejades'])

        # Comprovació a la tarda: torn NO ha d'estar bloquejat
        restr_tarda = get_restriccions_dia(data_test, torn_filtre='tarda')
        self.assertFalse(restr_tarda['te_restriccio'])
        self.assertNotIn('torn', restr_tarda['bloquejades'])

        # Comprovació disponibilitat completa
        disp = get_disponibilitat(data_test)
        franja_m1 = next((f for f in disp['franges'] if f['id'] == 'M1'), None)
        franja_t1 = next((f for f in disp['franges'] if f['id'] == 'T1'), None)

        if franja_m1:
            act_torn_m1 = next((a for a in franja_m1['activitats'] if a['id'] == 'torn'), None)
            self.assertTrue(act_torn_m1['bloquejada'], "Torn hauria d'estar bloquejat a M1")

        if franja_t1:
            act_torn_t1 = next((a for a in franja_t1['activitats'] if a['id'] == 'torn'), None)
            self.assertFalse(act_torn_t1['bloquejada'], "Torn NO hauria d'estar bloquejat a T1")

    def test_04_demo_seed_vouchers(self):
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO vals_regal 
                (codi, article_id, titol_experiencia, hores, activitat_id, nom_destinatari, nom_comprador, email_comprador, missatge, preu_pagat, data_creacio, data_caducitat, estat, metode_pagament, transaccio_id, notes)
                VALUES ('REGAL-DEMO-2026', 'art_torn_adult', 'Taller de torn (Adult)', 2.0, 'torn', 'Laura Soler (Demo)', 'Marc Amic', 'demo@exemple.cat', 'Perquè gaudeixis de la ceràmica!', 50.0, '2026-09-15', '2027-03-15', 'actiu', 'demo_sandbox', 'DEMO-TX-1', 'Val de prova demo')
            """)
            conn.commit()

            cursor.execute("SELECT * FROM vals_regal WHERE codi = 'REGAL-DEMO-2026'")
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row['estat'], 'actiu')
            self.assertEqual(row['hores'], 2.0)

if __name__ == '__main__':
    unittest.main()
