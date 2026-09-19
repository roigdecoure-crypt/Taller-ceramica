#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_security_remediation.py - Verificació automatitzada de la correcció C1 a C10
"""

import os
import sys
import unittest
import json
import io

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

class TestSecurityRemediation(unittest.TestCase):
    def setUp(self):
        server.init_db()

    def make_handler(self, path, method='GET', body_dict=None, headers=None):
        h = server.CeramicsRequestHandler.__new__(server.CeramicsRequestHandler)
        h.path = path
        h.command = method
        h.headers = headers or {}
        h.status_code = 200
        h.wfile = io.BytesIO()

        if body_dict is not None:
            raw_body = json.dumps(body_dict).encode('utf-8')
            h.rfile = io.BytesIO(raw_body)
            h.headers['Content-Length'] = str(len(raw_body))
            h.headers['Content-Type'] = 'application/json'
        else:
            h.rfile = io.BytesIO(b'')

        status_box = []
        def send_response(code, msg=None):
            status_box.append(code)
            h.status_code = code
        h.send_response = send_response
        h.send_header = lambda k, v: None
        h.end_headers = lambda: None
        return h, status_box

    def test_c1_block_db_and_backups_download(self):
        # 1. C1 - Intent de descarregar la base de dades directament
        h, sb = self.make_handler('/data/taller_ceramica.db', method='GET')
        h.do_GET()
        self.assertEqual(sb[0], 403)

        # 2. C1 - Intent de descarregar backups sense autenticació de Propietari
        h2, sb2 = self.make_handler('/api/admin/backups/download?file=backup.db', method='GET')
        h2.do_GET()
        self.assertEqual(sb2[0], 403)

    def test_c2_fail_closed_admin_endpoints(self):
        # C2 - Endpoints abans fail-open ara han de rebutjar peticions anònimes amb 401/403
        endpoints = [
            ('/api/festius', 'POST', {'nom': 'Festa Prova', 'data_inici': '2026-12-25'}),
            ('/api/restriccions-activitats', 'POST', {'activitat_id': 'torn', 'data': '2026-12-25'}),
            ('/api/config', 'POST', {'taller_nom': 'Hacked'}),
            ('/api/admin/backups', 'POST', {'action': 'backup'}),
        ]
        for ep, method, body in endpoints:
            h, sb = self.make_handler(ep, method=method, body_dict=body)
            h.do_POST()
            code = sb[0] if sb else 200
            self.assertIn(code, (401, 403), f"Endpoint {ep} hauria de rebutjar petició anònima (codi rebut: {code})")

    def test_c3_square_webhook_signature_required(self):
        # C3 - Webhook sense signatura ha de ser rebutjat
        h, sb = self.make_handler('/api/webhooks/square', method='POST', body_dict={'type': 'payment.created'})
        h.do_POST()
        code = sb[0] if sb else 200
        self.assertIn(code, (401, 403))

    def test_c4_auto_assignacio_hores_blocked(self):
        # C4 - Petició anònima a /api/paquets ha de ser rebutjada
        h, sb = self.make_handler('/api/paquets', method='POST', body_dict={
            'studentId': '231F',
            'hores': 100,
            'concepte': 'Gratis'
        })
        h.do_POST()
        code = sb[0] if sb else 200
        self.assertIn(code, (401, 403))

    def test_c5_student_pin_change_protection(self):
        # C5 - Canvi de PIN sense PIN actual ha de ser rebutjat
        h, sb = self.make_handler('/api/alumnes/canviar-pin', method='POST', body_dict={
            'student_id': '231F',
            'new_pin': '9999'
        })
        h.do_POST()
        code = sb[0] if sb else 200
        self.assertIn(code, (400, 401))

        # C5 - Recuperar PIN ja no retorna el PIN en text pla
        h2, sb2 = self.make_handler('/api/alumnes/recuperar-pin', method='POST', body_dict={
            'identifier': '231F'
        })
        h2.do_POST()
        res = json.loads(h2.wfile.getvalue().decode('utf-8'))
        self.assertFalse(res.get('ok'))
        self.assertEqual(res.get('code'), 'USE_OTP_RECOVERY')

    def test_c6_credentials_leak_sanitization(self):
        # C6 - GET /api/alumnes no ha d'incloure pin ni password_hash
        h, sb = self.make_handler('/api/alumnes', method='GET')
        h.do_GET()
        res = json.loads(h.wfile.getvalue().decode('utf-8'))
        students = res if isinstance(res, list) else res.get('alumnes', [])
        for st in students:
            self.assertNotIn('pin', st)
            self.assertNotIn('password_hash', st)

        # C6 - GET /api/config per anònims no ha d'incloure tokens sensibles
        h2, sb2 = self.make_handler('/api/config', method='GET')
        h2.do_GET()
        cfg = json.loads(h2.wfile.getvalue().decode('utf-8'))
        self.assertNotIn('square_access_token', cfg)
        self.assertNotIn('whatsapp_meta_token', cfg)
        self.assertNotIn('square_webhook_signature_key', cfg)

    def test_c7_xss_protection_in_frontend(self):
        # C7 - Comprovar que js/admin.js utilitza escapeHtml per a camps d'alumnes
        admin_js_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'js', 'admin.js')
        with open(admin_js_path, 'r', encoding='utf-8') as f:
            content = f.read()
        self.assertIn("escapeHtml(s.nom", content)
        self.assertIn("escapeHtml(s.cognoms", content)
        self.assertIn("escapeHtml(s.telefon", content)

    def test_c8_no_client_backdoor(self):
        # C8 - Comprovar que no existeix la porta del darrere offline amb PIN 1234
        admin_js_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'js', 'admin.js')
        with open(admin_js_path, 'r', encoding='utf-8') as f:
            content = f.read()
        self.assertNotIn("pin === '1234'", content)

    def test_c9_forcar_aforament_requires_admin(self):
        # C9 - Usuari anònim enviant forcar_aforament: true no ha de poder saltar-se l'aforament
        # Es comprova que la lògica de forcar_aforament requereix is_admin
        h, sb = self.make_handler('/api/reserves', method='POST', body_dict={
            'student_id': 'CLI-C9-TEST',
            'nom': 'Tester',
            'telefon': '600000000',
            'data': '2026-09-20',
            'hora_inici': '10:00',
            'activitat_id': 'torn',
            'places': 100,  # Sobrepassa de lluny qualsevol aforament
            'forcar_aforament': True
        })
        h.do_POST()
        res = json.loads(h.wfile.getvalue().decode('utf-8'))
        self.assertFalse(res.get('ok'))
        self.assertIn('aforament', res.get('error', '').lower())

    def test_c10_import_unauthorized_blocked(self):
        # C10 - Importació anònima ha de ser rebutjada
        h, sb = self.make_handler('/api/import', method='POST', body_dict={'config': {'admin_pin': '9999'}})
        h.do_POST()
        code = sb[0] if sb else 200
        self.assertEqual(code, 403)

    def test_authenticated_owner_access(self):
        # Comprovar que un Propietari amb credencials vàlides sí que pot accedir a la configuració completa
        token = server.create_auth_token('owner', hours=1)
        h, sb = self.make_handler('/api/config', method='GET', headers={'Authorization': f'Bearer {token}'})
        h.do_GET()
        res = json.loads(h.wfile.getvalue().decode('utf-8'))
        cfg = res.get('config', {})
        self.assertIn('taller_nom', cfg)
        self.assertIn('square_access_token', cfg)

if __name__ == '__main__':
    unittest.main()
