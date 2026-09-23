"""
Update n8n Code node to preserve pre-rendered backend templates if provided.
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib.n8n_helper import call_tool

def update_workflow():
    js_code = """const items = $input.all();
return items.map(entry => {
  const item = entry.json.body || entry.json;
  const nom = item.student_nom || 'Alumne';
  const data = item.data || '';
  const hora = item.hora_inici || '10:00';
  const act = item.activitat || 'Torn Lliure';
  const saldo = item.saldo_restant != null ? item.saldo_restant : '--';
  const cancelUrl = item.enllac_cancel || 'https://roigdecoure.cat/reserva.html';
  const canviarUrl = item.enllac_canviar || 'https://roigdecoure.cat/reserva.html';

  let rawTel = String(item.telefon || '').replace(/[^0-9]/g, '');
  if (rawTel.length === 9) rawTel = '34' + rawTel;

  const waText = item.wa_missatge || ('Hola ' + nom + '! T\\'hem confirmat la teva reserva al Taller de Ceràmica Roig de Coure pel dia ' + data + ' a les ' + hora + 'h (' + act + '). Per canviar o cancel·lar la teva cita: ' + cancelUrl);
  const waUrl = item.wa_link || ('https://wa.me/' + rawTel + '?text=' + encodeURIComponent(waText));
  const emailSubj = item.email_assumpte || ('Confirmació de Reserva: ' + data + ' (' + hora + 'h) - Roig de Coure');
  const emailHtml = item.email_html || ('<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0d5c1; border-radius: 8px; background-color: #faf7f2; color: #2d251e;"><h2 style="color: #b3542a;">Taller de Ceràmica Roig de Coure</h2><p>Hola <b>' + nom + '</b>,</p><p>La teva reserva ha estat confirmada.</p><p><a href="' + cancelUrl + '">Cancel·lar o canviar cita</a></p></div>');

  return {
    json: {
      ...item,
      wa_missatge: waText,
      wa_link: waUrl,
      email_assumpte: emailSubj,
      email_html: emailHtml,
      enllac_cancel: cancelUrl,
      enllac_canviar: canviarUrl,
      status: 'preparat_per_enviar',
      ok: true
    }
  };
});"""

    ops = [
        {
            'type': 'updateNodeParameters',
            'nodeName': 'Code',
            'parameters': {
                'mode': 'runOnceForAllItems',
                'language': 'javaScript',
                'jsCode': js_code
            }
        }
    ]

    print("Updating Code node...")
    res = call_tool('update_workflow', {
        'workflowId': 'dUbMeZXBuiuJOcXI',
        'operations': ops,
        'versionName': 'Preserve custom backend templates and buttons'
    })
    print("Update:", json.dumps(res, indent=2))

    print("Publishing...")
    res_pub = call_tool('publish_workflow', {'workflowId': 'dUbMeZXBuiuJOcXI'})
    print("Publish:", json.dumps(res_pub, indent=2))

if __name__ == '__main__':
    update_workflow()
