"""
Script to create the WhatsApp & Email notification workflow in n8n.
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib.n8n_helper import call_tool


WORKFLOW_CODE = '''import { workflow, trigger, node } from '@n8n/workflow-sdk';

const webhook = trigger({
  name: 'Webhook Reserva Event',
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  parameters: {
    httpMethod: 'POST',
    path: 'taller-reserva-notificacio',
    responseMode: 'responseNode'
  },
  output: [
    {
      body: {
        event: 'reserva_creada',
        student_nom: 'Maria Garcia',
        telefon: '612345678',
        email: 'maria@example.com',
        data: '2026-09-25',
        hora_inici: '10:00',
        hora_fi: '13:00',
        activitat: 'Torn Lliure',
        places: 1,
        saldo_restant: 9
      }
    }
  ]
});

const formatNotification = node({
  name: 'Format Missatges',
  type: 'n8n-nodes-base.code',
  version: 2,
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: "const items = $input.all();\\nreturn items.map(entry => {\\n  const item = entry.json.body || entry.json;\\n  const nom = item.student_nom || 'Alumne/a';\\n  const data = item.data || '';\\n  const hora = item.hora_inici || '10:00';\\n  const act = item.activitat || 'Torn Lliure';\\n  const saldo = item.saldo_restant != null ? item.saldo_restant : '--';\\n  let rawTel = String(item.telefon || '').replace(/[^0-9]/g, '');\\n  if (rawTel.length === 9) rawTel = '34' + rawTel;\\n  const waText = 'Hola ' + nom + '! T\\'hem confirmat la teva reserva al Taller de Ceramica Roig de Coure pel dia ' + data + ' a les ' + hora + 'h (' + act + '). Saldo restant: ' + saldo + ' hores.';\\n  const waUrl = 'https://wa.me/' + rawTel + '?text=' + encodeURIComponent(waText);\\n  const emailSubject = 'Confirmacio de Reserva: ' + data + ' (' + hora + 'h) - Roig de Coure';\\n  const emailHtml = '<div style=\"font-family: sans-serif; padding: 20px; color: #2D251E;\"><h2>Hola ' + nom + '!</h2><p>La teva reserva al taller ha estat confirmada:</p><ul><li><b>Data:</b> ' + data + '</li><li><b>Horari:</b> ' + hora + '</li><li><b>Activitat:</b> ' + act + '</li><li><b>Saldo de pack:</b> ' + saldo + ' hores restants</li></ul><p>Ens veiem al taller!</p></div>';\\n  return { json: { ...item, wa_text: waText, wa_url: waUrl, email_subject: emailSubject, email_html: emailHtml } };\\n});"
  },
  output: [
    {
      student_nom: 'Maria Garcia',
      telefon: '612345678',
      email: 'maria@example.com',
      data: '2026-09-25',
      hora_inici: '10:00',
      hora_fi: '13:00',
      activitat: 'Torn Lliure',
      places: 1,
      saldo_restant: 9,
      wa_text: 'Hola Maria Garcia...',
      wa_url: 'https://wa.me/34612345678?text=...',
      email_subject: 'Confirmacio de Reserva',
      email_html: '<p>...</p>'
    }
  ]
});

const respondWebhook = node({
  name: 'Respond to Webhook',
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  parameters: {
    respondWith: 'firstIncomingItem'
  },
  output: [
    {
      student_nom: 'Maria Garcia',
      wa_url: 'https://wa.me/34612345678?text=...'
    }
  ]
});

export default workflow('taller-notificacions', 'Taller Ceramica - Notificacions Reserva i Packs')
  .add(webhook)
  .to(formatNotification)
  .to(respondWebhook);
'''

def main():
    print("1. Validating workflow code...")
    val_res = call_tool('validate_workflow', {'code': WORKFLOW_CODE})
    print("Validation result:", json.dumps(val_res, indent=2))
    
    is_valid = val_res.get('result', {}).get('structuredContent', {}).get('valid', False)
    if not is_valid:
        print("Validation failed!")
        sys.exit(1)
        
    print("2. Creating workflow in n8n...")
    create_res = call_tool('create_workflow_from_code', {
        'code': WORKFLOW_CODE,
        'name': 'Taller Ceramica - Notificacions Reserva i Packs',
        'description': 'Receives booking and pack events from localhost/server and formats WhatsApp and Email notifications.',
        'versionName': 'v1.0 - Initial notification workflow'
    })
    print("Creation result:", json.dumps(create_res, indent=2))

if __name__ == '__main__':
    main()
