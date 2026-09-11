/**
 * api-config.js - Detecció automàtica de l'adreça del backend (Render / Local / OVH)
 * Permet que el frontend allotjat a qualsevol servidor (com OVH / roigdecoure.cat)
 * es connecti de manera transparent al servidor backend de Render (o local en desenvolupament).
 */
(function (window) {
  'use strict';

  function computeApiBase() {
    if (typeof window !== 'undefined') {
      // 1. Si s'ha definit manualment per variable global
      if (window.ROIG_API_BASE !== undefined && window.ROIG_API_BASE !== null && window.ROIG_API_BASE !== '') {
        return String(window.ROIG_API_BASE).replace(/\/+$/, '');
      }

      // 2. Si s'ha definit manualment a localStorage
      try {
        if (window.localStorage) {
          var custom = window.localStorage.getItem('roig_custom_api_base');
          if (custom) return custom.trim().replace(/\/+$/, '');
        }
      } catch (e) {}

      // 3. Detecció intel·ligent segons el domini actual
      if (window.location) {
        var host = window.location.hostname;
        // Si estem en desenvolupament local o directament al domini de Render, usem ruta relativa
        if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) {
          return '';
        }
      }
    }

    // 4. Per defecte quan s'executa des d'OVH (roigdecoure.cat) o un altre hosting extern
    return 'https://taller-ceramica-nb96.onrender.com';
  }

  var base = computeApiBase();
  window.ROIG_API_BASE = base;
  window.getRoigApiBase = computeApiBase;
})(typeof window !== 'undefined' ? window : this);
