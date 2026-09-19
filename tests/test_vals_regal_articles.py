import unittest
import json
import os
import sys
import io

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

class TestValsRegalIArticles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()

    def test_01_articles_catalog(self):
        articles = server.get_articles_catalog(include_inactive=True)
        self.assertGreaterEqual(len(articles), 3)
        for a in articles:
            self.assertGreater(a['preu'], 0)
            self.assertGreater(a['hores'], 0)
            self.assertIn(a['activitat_id'], ['torn', 'modelatge', 'pintar'])

    def test_02_creacio_i_verificacio_val_regal(self):
        val = server.crear_val_regal_db(
            titol_experiencia='Taller Torn Iniciacio (2h)',
            hores=2.0,
            activitat_id='torn',
            nom_destinatari='Marta Garcia',
            nom_comprador='Jordi Prat',
            telefon_comprador='+34612345678',
            email_comprador='jordi@exemple.cat',
            missatge='Per molts anys Marta!',
            preu_pagat=50.0,
            metode_pagament='square'
        )
        self.assertIsNotNone(val)
        self.assertTrue(val['codi'].startswith('REGAL-'))
        self.assertEqual(val['estat'], 'actiu')
        self.assertEqual(val['nom_destinatari'], 'Marta Garcia')
        self.assertEqual(val['telefon_comprador'], '+34612345678')
        self.assertEqual(val['email_comprador'], 'jordi@exemple.cat')
        self.assertEqual(val['hores'], 2.0)

        val_trobat = server.get_val_regal_db(val['codi'])
        self.assertIsNotNone(val_trobat)
        self.assertEqual(val_trobat['codi'], val['codi'])
        self.assertEqual(val_trobat['telefon_comprador'], '+34612345678')

    def test_03_generar_targeta_html_imprimible(self):
        val = server.crear_val_regal_db(
            titol_experiencia='Taller Modelatge Creatiu (2h)',
            hores=2.0,
            activitat_id='modelatge',
            nom_destinatari='Laura Soler',
            nom_comprador='Anna Vidal',
            missatge='Gaudeix molt del fang!',
            preu_pagat=45.0
        )
        html = server.generar_targeta_val_regal_html(val)
        self.assertIn('VAL REGAL', html)
        self.assertIn(val['codi'], html)
        self.assertIn('Laura Soler', html)

    def test_04_bescanvi_val_regal_un_sol_us(self):
        val = server.crear_val_regal_db(
            titol_experiencia='Taller Torn (2h)',
            hores=2.0,
            activitat_id='torn',
            nom_destinatari='Pol Mas',
            preu_pagat=50.0
        )
        codi = val['codi']
        
        res = server.bescanviar_val_regal_db(codi, reserva_id='RES-TEST-101', alumne_id='CLI-101')
        self.assertTrue(res['ok'])
        
        val_actualitzat = server.get_val_regal_db(codi)
        self.assertEqual(val_actualitzat['estat'], 'canviat')
        self.assertEqual(val_actualitzat['reserva_id'], 'RES-TEST-101')
        
        res2 = server.bescanviar_val_regal_db(codi, reserva_id='RES-TEST-102')
        self.assertFalse(res2['ok'])

    def test_05_editar_val_regal(self):
        val = server.crear_val_regal_db(
            titol_experiencia='Taller de torn (Adult)',
            hores=2.0,
            activitat_id='torn',
            nom_destinatari='Carla Puig',
            preu_pagat=50.0
        )
        codi = val['codi']

        # Modificar dades del val
        handler = server.CeramicsRequestHandler.__new__(server.CeramicsRequestHandler)
        handler.path = '/api/vals-regal/editar'
        body = json.dumps({
            'codi': codi,
            'nom_destinatari': 'Carla Puig Vives',
            'nom_comprador': 'Joan Vives',
            'telefon_comprador': '+34699887766',
            'missatge': 'Felicitats!',
            'titol_experiencia': 'Taller de torn (Adult)',
            'hores': 2.0,
            'preu_pagat': 50.0,
            'data_caducitat': '2027-12-31',
            'estat': 'actiu'
        }).encode('utf-8')
        handler.headers = {'Content-Length': str(len(body)), 'Content-Type': 'application/json'}
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        status_box = []
        handler.send_response = lambda c, m=None: status_box.append(c)
        handler.send_header = lambda k, v: None
        handler.end_headers = lambda: None
        handler.do_POST()

        self.assertEqual(status_box[0] if status_box else 200, 200)
        res_data = json.loads(handler.wfile.getvalue().decode('utf-8'))
        self.assertTrue(res_data['ok'])
        
        val_db = server.get_val_regal_db(codi)
        self.assertEqual(val_db['nom_destinatari'], 'Carla Puig Vives')
        self.assertEqual(val_db['nom_comprador'], 'Joan Vives')
        self.assertEqual(val_db['telefon_comprador'], '+34699887766')
        self.assertEqual(val_db['missatge'], 'Felicitats!')
        self.assertEqual(val_db['data_caducitat'], '2027-12-31')

if __name__ == '__main__':
    unittest.main()