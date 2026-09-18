/**
 * roigdecoure-web.js - Motor interactiu trencador per a Roig de Coure
 * Scroll reveals, parallax hero, reserves en viu, val regal, FAQ
 */
(function () {
  'use strict';

  const CFG = {
    phone: '34683633880',
    email: 'roigdecoure@gmail.com',
    capacities: {
      torn: 4,
      modelatge: 8,
      pintar: 12,
      experiencia_torn_adult: 4,
      experiencia_torn_infant: 4,
      vidre: 6
    },
    names: {
      torn: 'Torn',
      modelatge: 'Modelatge',
      pintar: 'Pintar Ceràmica',
      experiencia_torn_adult: 'Experiència al torn adults',
      experiencia_torn_infant: 'Experiència al torn menors 12 anys',
      vidre: 'Fusió de Vidre'
    },
    closedWeekdays: [1, 2]
  };

  const booking = {
    activity: 'torn', numPersons: 1, date: null, shift: 'mati', arrivalTime: '10:00',
    currentMonth: new Date().getMonth(), currentYear: new Date().getFullYear()
  };

  function initAll() {
    initScrollReveals();
    initHeroBackgroundSlider();
    initNavigation();
    initBookingEngine();
    initGiftVoucher();
    initFaqAccordion();
    initContactForm();
    initSocAlumneAndValRegal();
    initActivitatsInfoPopups();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  /* ==== SCROLL REVEAL amb IntersectionObserver ==== */
  function initScrollReveals() {
    var els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (!els.length) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { observer.observe(el); });
  }

  /* ==== HERO BACKGROUND SLIDER (FONS CANVIANT AMB TRANSICIÓ SUAU) ==== */
  function initHeroBackgroundSlider() {
    var slides = document.querySelectorAll('.hero-slide');
    var dots = document.querySelectorAll('.hero-dot');
    var slider = document.getElementById('hero-bg-slider');
    var hero = document.querySelector('.hero-section');
    if (!slides.length) return;

    var currentIdx = 0;
    var timer = null;
    var intervalDuration = 9000;

    function goToSlide(idx) {
      slides.forEach(function (s, i) {
        s.classList.toggle('active', i === idx);
      });
      dots.forEach(function (d, i) {
        d.classList.toggle('active', i === idx);
      });
      currentIdx = idx;
    }

    function nextSlide() {
      var next = (currentIdx + 1) % slides.length;
      goToSlide(next);
    }

    function startTimer() {
      stopTimer();
      timer = setInterval(nextSlide, intervalDuration);
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var idx = parseInt(dot.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          goToSlide(idx);
          startTimer();
        }
      });
    });

    startTimer();

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          var scrollY = window.pageYOffset;
          if (scrollY < window.innerHeight && slider) {
            slider.style.transform = 'translateY(' + (scrollY * 0.28) + 'px)';
            if (hero) {
              hero.style.opacity = Math.max(0, 1 - scrollY / (window.innerHeight * 0.92));
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ==== NAVEGACIO ==== */
  function initNavigation() {
    var header = document.querySelector('.site-header');
    var toggle = document.getElementById('menu-toggle');
    var backdrop = document.getElementById('nav-mobile-backdrop');

    window.addEventListener('scroll', function () {
      if (header) {
        header.classList.toggle('scrolled', window.scrollY > 50);
      }
      updateActiveNav();
    });

    if (toggle) {
      toggle.addEventListener('click', function () {
        var isOpen = document.body.classList.toggle('nav-mobile-open');
        this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', function () {
        document.body.classList.remove('nav-mobile-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    }

    // Dropdown toggle for Activitats
    var actToggle = document.getElementById('activitats-toggle');
    var actDropdown = document.querySelector('.nav-item-dropdown');

    if (actToggle && actDropdown) {
      actToggle.addEventListener('click', function (e) {
        if (window.innerWidth <= 960) {
          e.preventDefault();
          actDropdown.classList.toggle('open');
          var isOpen = actDropdown.classList.contains('open');
          actToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
      });
    }

    document.querySelectorAll('.nav-link:not(.dropdown-toggle), .dropdown-item, .nav-mobile-action-item a').forEach(function (link) {
      link.addEventListener('click', function () {
        document.body.classList.remove('nav-mobile-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        if (actDropdown) {
          actDropdown.classList.remove('open');
          if (actToggle) actToggle.setAttribute('aria-expanded', 'false');
        }

        var href = this.getAttribute('href');
        if (href && href.startsWith('#') && href.length > 1) {
          try {
            var targetEl = document.querySelector(href);
            if (targetEl) {
              targetEl.classList.add('visible');
            }
          } catch (err) {}
        }
      });
    });

    if (window.location.hash) {
      try {
        var initialHashEl = document.querySelector(window.location.hash);
        if (initialHashEl) initialHashEl.classList.add('visible');
      } catch (err) {}
    }

    document.addEventListener('click', function (e) {
      if (actDropdown && !actDropdown.contains(e.target)) {
        actDropdown.classList.remove('open');
        if (actToggle) actToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.querySelectorAll('[data-book-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        selectActivity(this.getAttribute('data-book-act'));
        var sec = document.getElementById('reserves');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function updateActiveNav() {
    var sections = ['inici', 'activitats', 'reserves', 'val-regal', 'tarifes', 'faq', 'contacte'];
    var current = '';
    sections.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && window.scrollY >= el.offsetTop - 120) current = id;
    });
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  }

  /* ==== MOTOR DE RESERVES ==== */
  
  async function loadWebActivitatsConfig() {
    try {
      var apiBase = getWebApiBase();
      var res = await fetch(apiBase + '/api/reserves/activitats?t=' + Date.now());
      var data = await res.json();
      if (data && data.ok && data.activitats) {
        data.activitats.forEach(function(act) {
          if (act.id) {
            if (act.capacitatMax) CFG.capacities[act.id] = act.capacitatMax;
            if (act.nom) CFG.names[act.id] = act.nom;
          }
          var btn = document.querySelector('.booking-act-btn[data-act="' + act.id + '"]');
          if (btn) {
            if (act.descripcio) {
              var sub = btn.querySelector('.booking-act-subtitle');
              if (sub) sub.textContent = act.descripcio;
            }
            if (act.nom) {
              var nameEl = btn.querySelector('.booking-act-name');
              if (nameEl) nameEl.textContent = act.nom;
            }
            if (act.capacitatMax) {
              var badge = btn.querySelector('.booking-act-badge');
              if (badge) badge.textContent = (act.id === 'torn' || act.id.indexOf('torn') !== -1) ? (act.capacitatMax + ' torns') : (act.capacitatMax + ' places');
            }
          }
        });
      }
    } catch(e) {
      console.warn('Fallback activitats config');
    }
  }

  function initBookingEngine() {
    loadWebActivitatsConfig();
    document.querySelectorAll('.booking-act-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { selectActivity(this.getAttribute('data-act')); });
    });

    var personsEl = document.getElementById('booking-persons');
    if (personsEl) personsEl.addEventListener('change', function () {
      booking.numPersons = parseInt(this.value) || 1;
      updateShiftSpots();
    });

    var prevBtn = document.getElementById('cal-prev-btn');
    var nextBtn = document.getElementById('cal-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', function () {
      var now = new Date();
      var pm = booking.currentMonth - 1;
      var py = pm < 0 ? booking.currentYear - 1 : booking.currentYear;
      if (py < now.getFullYear() || (py === now.getFullYear() && (pm < 0 ? 11 : pm) < now.getMonth())) return;
      booking.currentMonth = pm < 0 ? 11 : pm;
      booking.currentYear = py;
      renderCalendar();
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var nm = booking.currentMonth + 1;
      booking.currentMonth = nm > 11 ? 0 : nm;
      booking.currentYear = nm > 11 ? booking.currentYear + 1 : booking.currentYear;
      renderCalendar();
    });

    document.querySelectorAll('.shift-card').forEach(function (card) {
      card.addEventListener('click', function () {
        if (this.classList.contains('disabled')) return;
        document.querySelectorAll('.shift-card').forEach(function (c) { c.classList.remove('selected'); });
        this.classList.add('selected');
        booking.shift = this.getAttribute('data-shift');
        var arr = document.getElementById('booking-arrival-time');
        if (arr) {
          // Filtrar opcions: mostrar només les hores del torn seleccionat
          var isMati = booking.shift === 'mati';
          Array.from(arr.options).forEach(function (opt) {
            var h = parseInt(opt.value.split(':')[0], 10);
            opt.style.display = (isMati ? h < 14 : h >= 14) ? '' : 'none';
            opt.disabled = (isMati ? h >= 14 : h < 14);
          });
          arr.value = isMati ? '10:00' : '17:00';
          booking.arrivalTime = arr.value;
        }
      });
    });

    var arrSel = document.getElementById('booking-arrival-time');
    if (arrSel) arrSel.addEventListener('change', function () { booking.arrivalTime = this.value; });

    var chkVal = document.getElementById('chk-val-regal');
    var valWrap = document.getElementById('val-code-wrap');
    if (chkVal && valWrap) chkVal.addEventListener('change', function () { valWrap.style.display = this.checked ? 'block' : 'none'; });

    var chkAlu = document.getElementById('chk-soc-alumne');
    var aluWrap = document.getElementById('alumne-code-wrap');
    if (chkAlu && aluWrap) chkAlu.addEventListener('change', function () { aluWrap.style.display = this.checked ? 'block' : 'none'; });

    var form = document.getElementById('public-booking-form');
    if (form) form.addEventListener('submit', handleBookingSubmit);

    initSocAlumneAndValRegal();
    selectInitialDate();
    renderCalendar();
  }

  function selectActivity(act) {
    if (!CFG.capacities[act]) return;
    booking.activity = act;
    document.querySelectorAll('.booking-act-btn').forEach(function (b) {
      b.classList.toggle('selected', b.getAttribute('data-act') === act);
    });
    var max = CFG.capacities[act];
    var sel = document.getElementById('booking-persons');
    if (sel) {
      var cur = Math.min(parseInt(sel.value) || 1, max);
      sel.innerHTML = '';
      for (var i = 1; i <= max; i++) {
        var opt = document.createElement('option');
        opt.value = i; opt.textContent = i === 1 ? '1 persona' : i + ' persones';
        if (i === cur) opt.selected = true;
        sel.appendChild(opt);
      }
      booking.numPersons = cur;
    }
    renderCalendar();
    updateShiftSpots();
  }
  window.selectActivity = selectActivity;

  function selectInitialDate() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    for (var i = 0; i < 14; i++) {
      if (!CFG.closedWeekdays.includes(d.getDay())) {
        booking.date = fmtDate(d);
        booking.currentMonth = d.getMonth();
        booking.currentYear = d.getFullYear();
        break;
      }
      d.setDate(d.getDate() + 1);
    }
  }

  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderCalendar() {
    var grid = document.getElementById('cal-grid-days');
    var titleEl = document.getElementById('cal-month-title');
    if (!grid || !titleEl) return;
    var mNames = ['Gener','Febrer','Marc','Abril','Maig','Juny','Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];
    titleEl.textContent = mNames[booking.currentMonth] + ' ' + booking.currentYear;
    grid.innerHTML = '';
    var firstDay = new Date(booking.currentYear, booking.currentMonth, 1).getDay();
    var offset = firstDay === 0 ? 6 : firstDay - 1;
    var total = new Date(booking.currentYear, booking.currentMonth + 1, 0).getDate();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 0; i < offset; i++) { var e = document.createElement('div'); e.className = 'cal-day empty'; grid.appendChild(e); }
    for (var day = 1; day <= total; day++) {
      var dateObj = new Date(booking.currentYear, booking.currentMonth, day);
      var ds = fmtDate(dateObj);
      var cell = document.createElement('div');
      cell.className = 'cal-day'; cell.textContent = day;
      if (dateObj < today) { cell.classList.add('disabled'); }
      else if (CFG.closedWeekdays.includes(dateObj.getDay())) { cell.classList.add('closed-day'); cell.title = 'Tancat'; }
      else {
        cell.classList.add('available');
        if (booking.date === ds) cell.classList.add('selected');
        (function (d) { cell.addEventListener('click', function () { booking.date = d; renderCalendar(); updateShiftSpots(); }); })(ds);
      }
      grid.appendChild(cell);
    }
    updateDateLabel();
  }

  function updateDateLabel() {
    var el = document.getElementById('selected-date-label');
    if (!el || !booking.date) return;
    var p = booking.date.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    var dn = ['Diumenge','Dilluns','Dimarts','Dimecres','Dijous','Divendres','Dissabte'];
    var mn = ['gener','febrer','marc','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre'];
    el.textContent = dn[d.getDay()] + ', ' + p[2] + ' de ' + mn[d.getMonth()] + ' de ' + p[0];
  }

  function getWebApiBase() {
    if (typeof window.getRoigApiBase === 'function') {
      return window.getRoigApiBase();
    }
    if (window.ROIG_API_BASE) return window.ROIG_API_BASE;
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) {
      return '';
    }
    return 'https://taller-ceramica-nb96.onrender.com';
  }

  async function updateShiftSpots() {
    var sm = document.getElementById('spots-mati');
    var st = document.getElementById('spots-tarda');
    var max = CFG.capacities[booking.activity] || 4;
    if (!sm || !st || !booking.date) return;
    try {
      var apiBase = getWebApiBase();
      var res = await fetch(apiBase + '/api/reserves/disponibilitat?data=' + booking.date + '&activitat=' + booking.activity);
      if (res.ok) {
        var data = await res.json();
        var fm = data.franges.find(function (f) { return f.id === 'mati' || f.id === 'M1'; });
        var ft = data.franges.find(function (f) { return f.id === 'tarda' || f.id === 'T1'; });

        function getActPlaces(franja) {
          if (!franja) return max;
          if (franja.activitats && Array.isArray(franja.activitats)) {
            var found = franja.activitats.find(function (a) { return a.id === booking.activity; });
            if (found && found.placesDisponibles !== undefined) {
              return found.placesDisponibles;
            }
          }
          return franja.placesLliures !== undefined ? Math.min(max, franja.placesLliures) : (franja.disponibles !== undefined ? Math.min(max, franja.disponibles) : max);
        }

        var dispM = getActPlaces(fm);
        var dispT = getActPlaces(ft);
        sm.textContent = dispM + ' places disponibles';
        st.textContent = dispT + ' places disponibles';

        var cardM = document.querySelector('.shift-card[data-shift="mati"]');
        var cardT = document.querySelector('.shift-card[data-shift="tarda"]');
        if (cardM) cardM.classList.toggle('disabled', dispM <= 0);
        if (cardT) cardT.classList.toggle('disabled', dispT <= 0);
        return;
      }
    } catch (e) { /* offline */ }
    sm.textContent = max + ' places disponibles';
    st.textContent = max + ' places disponibles';
  }

  async function handleBookingSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var btn = form.querySelector('button[type="submit"]');
    var nom = (form.querySelector('#client-nom') || {}).value || '';
    var tel = (form.querySelector('#client-tel') || {}).value || '';
    var email = (form.querySelector('#client-email') || {}).value || '';
    var notes = (form.querySelector('#client-notes') || {}).value || '';
    var isVal = (form.querySelector('#chk-val-regal') || {}).checked;
    var valCode = (form.querySelector('#val-code-input') || {}).value || '';
    var isAlu = (form.querySelector('#chk-soc-alumne') || {}).checked;
    var aluId = (form.querySelector('#alumne-code-input') || {}).value || '';
    nom = nom.trim(); tel = tel.trim();
    if (!nom || !tel) { alert('Indica el teu nom i telefon.'); return; }
    if (!booking.date) { alert('Selecciona una data.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Tramitant...'; }
    var payload = {
      activitat_id: booking.activity, activitat: CFG.names[booking.activity],
      places: booking.numPersons, data: booking.date, franja_id: booking.shift,
      hora_inici: booking.arrivalTime, nom: nom, telefon: tel, email: email.trim(),
      notes: notes.trim(), val_regal: isVal ? 1 : 0, codi_val_regal: valCode.trim(),
      soc_alumne: isAlu ? 1 : 0, student_id: aluId.trim()
    };
    try {
      var apiBase = getWebApiBase();
      var res = await fetch(apiBase + '/api/reserves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      var r = await res.json();
      if (res.ok && r.ok) {
        showModal({ nom: nom, tel: tel, act: CFG.names[booking.activity], places: booking.numPersons,
          data: booking.date, torn: booking.shift === 'mati' ? 'Mati (10-13h)' : 'Tarda (17-20h)',
          hora: booking.arrivalTime, val: isVal ? (valCode || 'Si') : null, id: r.id || 'CONF-' + Date.now().toString().slice(-6) });
        form.reset();
      } else { alert(r.error || 'No s ha pogut completar la reserva.'); }
    } catch (err) {
      showModal({ nom: nom, tel: tel, act: CFG.names[booking.activity], places: booking.numPersons,
        data: booking.date, torn: booking.shift === 'mati' ? 'Mati (10-13h)' : 'Tarda (17-20h)',
        hora: booking.arrivalTime, val: isVal ? (valCode || 'Si') : null, id: 'PENDENT-WA' });
      form.reset();
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Reserva de Plaça'; } }
  }

  function formatDataEuropea(dateStr) {
    if (!dateStr) return '';
    var parts = String(dateStr).split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return dateStr;
  }

  function showModal(d) {
    var modal = document.getElementById('booking-modal');
    var content = document.getElementById('modal-summary-content');
    var waBtn = document.getElementById('modal-wa-btn');
    if (!modal) return;
    var dataEU = formatDataEuropea(d.data);
    if (content) content.innerHTML =
      '<div style="background:#FBF4F2;border:1px solid #E8E1DA;border-radius:8px;padding:16px;margin:16px 0;font-size:14px;line-height:1.6;">' +
      '<p><strong>Titular:</strong> ' + esc(d.nom) + '</p>' +
      '<p><strong>Activitat:</strong> ' + esc(d.act) + '</p>' +
      '<p><strong>Places:</strong> ' + d.places + '</p>' +
      '<p><strong>Data:</strong> ' + esc(dataEU) + '</p>' +
      '<p><strong>Torn:</strong> ' + esc(d.torn) + ' (Arribada ' + d.hora + 'h)</p>' +
      (d.val ? '<p><strong>Val Regal:</strong> ' + esc(d.val) + '</p>' : '') +
      '<p style="margin-top:8px;font-size:12px;color:#787069;">Ref: <code>' + esc(d.id) + '</code></p></div>';
    if (waBtn) {
      var t = encodeURIComponent('Hola Roig de Coure! Reserva:\n- ' + d.act + '\n- Data: ' + dataEU +
        '\n- Torn: ' + d.torn + ' (' + d.hora + 'h)\n- Places: ' + d.places + '\n- Nom: ' + d.nom + '\n- Tel: ' + d.tel);
      waBtn.href = 'https://wa.me/' + CFG.phone + '?text=' + t;
    }
    modal.classList.add('active');
    var close = document.getElementById('modal-close-btn');
    if (close) close.onclick = function () { modal.classList.remove('active'); };
  }

  /* ==== VAL REGAL & PACK D'HORES (SQUARE CHECKOUT) ==== */
  var modalitatRegal = 'experiencia'; // 'experiencia' o 'hores'

  function canviarModalitatRegal(mode) {
    modalitatRegal = mode;
    var btnExp = document.getElementById('tab-val-exp');
    var btnHores = document.getElementById('tab-val-hores');
    var panelExp = document.getElementById('panel-regal-exp');
    var panelHores = document.getElementById('panel-regal-hores');

    if (mode === 'experiencia') {
      if (btnExp) btnExp.classList.add('active');
      if (btnHores) btnHores.classList.remove('active');
      if (panelExp) panelExp.style.display = 'block';
      if (panelHores) panelHores.style.display = 'none';
    } else {
      if (btnExp) btnExp.classList.remove('active');
      if (btnHores) btnHores.classList.add('active');
      if (panelExp) panelExp.style.display = 'none';
      if (panelHores) panelHores.style.display = 'block';
      actualitzarCalculHoresWeb();
    }
    actualitzarPreviewRegal();
  }
  window.canviarModalitatRegal = canviarModalitatRegal;

  function fixarHoresWeb(h) {
    var inp = document.getElementById('input-web-hores');
    if (inp) {
      inp.value = h;
      actualitzarCalculHoresWeb();
    }
  }
  window.fixarHoresWeb = fixarHoresWeb;

  function calcularPreuHoresTramsWeb(hores, esInfant) {
    // Compra mínima de 4 hores
    var h = Math.max(4, parseInt(hores, 10) || 4);
    var preuHora = 15;
    if (!esInfant) {
      if (h <= 9) preuHora = 15;
      else if (h <= 19) preuHora = 14;
      else preuHora = 13;
    } else {
      if (h <= 9) preuHora = 14;
      else if (h <= 19) preuHora = 13;
      else preuHora = 11;
    }
    return { hores: h, preuHora: preuHora, total: h * preuHora };
  }

  function actualitzarCalculHoresWeb() {
    var inpHores = document.getElementById('input-web-hores');
    var rawVal = inpHores ? parseInt(inpHores.value, 10) : 10;
    var h = isNaN(rawVal) ? 4 : Math.max(4, rawVal);
    if (inpHores && inpHores.value && rawVal < 4) {
      inpHores.value = 4;
    }
    var radEdat = document.querySelector('input[name="hores-edat"]:checked');
    var esInfant = radEdat && radEdat.value === 'infant';

    // Actualitzar etiquetes visuals de radio
    var lblAd = document.getElementById('lbl-hores-adult');
    var lblInf = document.getElementById('lbl-hores-infant');
    if (lblAd) lblAd.classList.toggle('active', !esInfant);
    if (lblInf) lblInf.classList.toggle('active', esInfant);

    var calc = calcularPreuHoresTramsWeb(h, esInfant);

    var txtTarifa = document.getElementById('web-tarifa-txt');
    if (txtTarifa) txtTarifa.textContent = calc.preuHora.toFixed(2).replace('.', ',') + ' € / h';

    var txtTotal = document.getElementById('web-total-hores-txt');
    if (txtTotal) txtTotal.textContent = calc.total.toFixed(2).replace('.', ',') + ' €';

    // Renderitzar trams visuals
    var cPreview = document.getElementById('web-trams-preview');
    if (cPreview) {
      var trams = !esInfant
        ? [ { r: '4h - 9h', p: 15, min: 4, max: 9 }, { r: '10h - 19h', p: 14, min: 10, max: 19 }, { r: '20h+', p: 13, min: 20, max: 999 } ]
        : [ { r: '4h - 9h', p: 14, min: 4, max: 9 }, { r: '10h - 19h', p: 13, min: 10, max: 19 }, { r: '20h+', p: 11, min: 20, max: 999 } ];

      cPreview.innerHTML = trams.map(function(t) {
        var act = (h >= t.min && h <= t.max) ? 'active' : '';
        return '<div class="tram-card ' + act + '">' +
                 '<div style="font-weight:700;">' + t.r + '</div>' +
                 '<div style="font-size:12px; font-weight:800;">' + t.p + '€/h</div>' +
               '</div>';
      }).join('');
    }

    actualitzarPreviewRegal();
  }
  window.actualitzarCalculHoresWeb = actualitzarCalculHoresWeb;

  function actualitzarPreviewRegal() {
    var titolExp = 'Experiència al Taller';
    var preuFinal = 50;

    if (modalitatRegal === 'experiencia') {
      var expSel = document.getElementById('gift-exp-select');
      if (expSel && expSel.selectedOptions && expSel.selectedOptions[0]) {
        var opt = expSel.selectedOptions[0];
        titolExp = opt.dataset.title || opt.textContent;
        preuFinal = parseFloat(opt.dataset.price) || 50;
      }
    } else {
      var inpHores = document.getElementById('input-web-hores');
      var h = inpHores ? (parseInt(inpHores.value, 10) || 1) : 10;
      var radEdat = document.querySelector('input[name="hores-edat"]:checked');
      var esInfant = radEdat && radEdat.value === 'infant';
      var calc = calcularPreuHoresTramsWeb(h, esInfant);
      titolExp = 'Pack de ' + calc.hores + ' hores (' + (esInfant ? 'Infantil' : 'Adult') + ')';
      preuFinal = calc.total;
    }

    var elTitol = document.getElementById('preview-gift-exp');
    if (elTitol) elTitol.textContent = titolExp;

    var elPreu = document.getElementById('preview-gift-preu-badge');
    if (elPreu) elPreu.textContent = preuFinal.toFixed(2).replace('.', ',') + ' €';

    var btnPay = document.getElementById('btn-final-square-pay');
    if (btnPay) btnPay.textContent = 'Pagar ara amb Square (' + preuFinal.toFixed(2).replace('.', ',') + ' €)';

    // Personalització en viu
    var destVal = (document.getElementById('regal-web-destinatari') || {}).value || '';
    var boxDest = document.getElementById('preview-gift-dest');
    var spanDest = document.getElementById('preview-gift-dest-nom');
    if (boxDest && spanDest) {
      if (destVal.trim()) {
        boxDest.style.display = 'block';
        spanDest.textContent = destVal.trim();
      } else {
        boxDest.style.display = 'none';
      }
    }

    var fromVal = (document.getElementById('regal-web-comprador') || {}).value || '';
    var boxFrom = document.getElementById('preview-gift-from');
    var spanFrom = document.getElementById('preview-gift-from-nom');
    if (boxFrom && spanFrom) {
      if (fromVal.trim()) {
        boxFrom.style.display = 'block';
        spanFrom.textContent = fromVal.trim();
      } else {
        boxFrom.style.display = 'none';
      }
    }

    var msgVal = (document.getElementById('regal-web-missatge') || {}).value || '';
    var elDed = document.getElementById('preview-gift-dedicatoria');
    if (elDed) {
      elDed.textContent = msgVal.trim()
        ? '«' + msgVal.trim() + '»'
        : 'Una experiència artesanal única per gaudir i crear amb les mans.';
    }
  }
  window.actualitzarPreviewRegal = actualitzarPreviewRegal;

  async function iniciarPagamentFinalSquare() {
    var btn = document.getElementById('btn-final-square-pay');
    var dest = (document.getElementById('regal-web-destinatari') || {}).value || '';
    var comprador = (document.getElementById('regal-web-comprador') || {}).value || '';
    var email = (document.getElementById('regal-web-email') || {}).value || '';
    var msg = (document.getElementById('regal-web-missatge') || {}).value || '';

    if (!dest.trim() || !email.trim()) {
      alert('Si us plau, indica el nom del destinatari i el teu correu electrònic.');
      return;
    }

    var articleId = 'art_torn_adult';
    var reqHores = null;
    var reqEdat = null;

    if (modalitatRegal === 'experiencia') {
      var expSel = document.getElementById('gift-exp-select');
      articleId = (expSel && expSel.value) || 'art_torn_adult';
    } else {
      var inpHores = document.getElementById('input-web-hores');
      reqHores = inpHores ? (parseInt(inpHores.value, 10) || 10) : 10;
      var radEdat = document.querySelector('input[name="hores-edat"]:checked');
      var esInf = radEdat && radEdat.value === 'infant';
      reqEdat = esInf ? 'infant' : 'adult';
      articleId = esInf ? 'art_hores_infant' : 'art_hores_adult';
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Connexió amb Square...';
    }

    try {
      var apiBase = typeof getRoigApiBase === 'function' ? getRoigApiBase() : '';
      var res = await fetch(apiBase + '/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_id: articleId,
          tipus_compra: 'val_regal',
          hores: reqHores,
          edat: reqEdat,
          nom_destinatari: dest.trim(),
          nom_comprador: comprador.trim(),
          email_comprador: email.trim(),
          missatge: msg.trim()
        })
      });
      var data = await res.json();
      if (res.ok && data.ok) {
        if (data.checkout_url) {
          window.location.href = data.checkout_url;
        } else {
          alert('Val creat correctament! Codi del val: ' + (data.codi_val || 'generat'));
          window.location.reload();
        }
      } else {
        alert(data.error || 'No s\'ha pogut connectar amb la passarel·la.');
        if (btn) {
          btn.disabled = false;
          actualitzarPreviewRegal();
        }
      }
    } catch(err) {
      alert('Error de comunicació amb el servidor: ' + err.message);
      if (btn) {
        btn.disabled = false;
        actualitzarPreviewRegal();
      }
    }
  }
  window.iniciarPagamentFinalSquare = iniciarPagamentFinalSquare;

  async function consultarValWeb() {
    var inp = document.getElementById('web-cerca-val');
    var resBox = document.getElementById('web-cerca-val-resultat');
    var codi = (inp ? inp.value : '').trim().toUpperCase();
    if (!codi) {
      if (resBox) {
        resBox.style.display = 'block';
        resBox.style.background = '#FEE2E2';
        resBox.style.color = '#991B1B';
        resBox.textContent = 'Introdueix un codi de val.';
      }
      return;
    }
    if (resBox) {
      resBox.style.display = 'block';
      resBox.style.background = '#F3F4F6';
      resBox.style.color = '#4B5563';
      resBox.textContent = 'Comprovant val...';
    }

    try {
      var apiBase = typeof getRoigApiBase === 'function' ? getRoigApiBase() : '';
      var res = await fetch(apiBase + '/api/vals-regal/verificar/' + encodeURIComponent(codi));
      var data = await res.json();
      if (res.ok && data.ok && data.val) {
        var v = data.val;
        var estatTxt = v.estat === 'actiu' ? '✓ Actiu i llest per reservar' : ('Estat: ' + v.estat);
        var bg = v.estat === 'actiu' ? '#ECFDF5' : '#FEF3C7';
        var col = v.estat === 'actiu' ? '#065F46' : '#92400E';
        resBox.style.background = bg;
        resBox.style.color = col;
        resBox.innerHTML = '<strong>' + estatTxt + '</strong><br>' +
          'Experiència: ' + esc(v.titol_experiencia || 'Taller de ceràmica') + ' (' + v.hores + 'h)<br>' +
          'Destinatari: ' + esc(v.nom_destinatari || '') + '<br>' +
          'Caduca el: ' + esc(v.data_caducitat || '6 mesos') + '<br>' +
          '<a href="reserva.html?val=' + encodeURIComponent(v.codi) + '" style="display:inline-block; margin-top:6px; font-weight:700; color:' + col + '; text-decoration:underline;">Reservar hora ara amb aquest val &rarr;</a>';
      } else {
        resBox.style.background = '#FEE2E2';
        resBox.style.color = '#991B1B';
        resBox.innerHTML = data.error || 'Aquest codi no s\'ha trobat.';
      }
    } catch(err) {
      resBox.style.background = '#FEE2E2';
      resBox.style.color = '#991B1B';
      resBox.textContent = 'Error consultant el val: ' + err.message;
    }
  }
  window.consultarValWeb = consultarValWeb;

  function initGiftVoucher() {
    actualitzarCalculHoresWeb();
    actualitzarPreviewRegal();
  }

  /* ==== FAQ ==== */
  function initFaqAccordion() {
    document.querySelectorAll('.faq-item').forEach(function (item) {
      var q = item.querySelector('.faq-question');
      if (q) q.addEventListener('click', function () {
        document.querySelectorAll('.faq-item').forEach(function (o) { if (o !== item) o.classList.remove('open'); });
        item.classList.toggle('open');
      });
    });
  }

  /* ==== CONTACTE ==== */
  function initContactForm() {
    var form = document.getElementById('contact-quick-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nom = (form.querySelector('#c-nom') || {}).value || '';
      var tel = (form.querySelector('#c-tel') || {}).value || '';
      var msg = (form.querySelector('#c-msg') || {}).value || '';
      if (!nom.trim() || !msg.trim()) { alert('Indica el teu nom i missatge.'); return; }
      var t = encodeURIComponent('Hola Roig de Coure! Consulta:\n- Nom: ' + nom.trim() +
        '\n- Tel: ' + (tel.trim() || 'No indicat') + '\n- Missatge: ' + msg.trim());
      window.open('https://wa.me/' + CFG.phone + '?text=' + t, '_blank');
      form.reset();
    });
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    /* ==== GESTIÓ SÓC ALUMNE I VAL REGAL ==== */
  function initSocAlumneAndValRegal() {
    var checkSoc = document.getElementById('check-soc-alumne');
    var cardSoc = document.getElementById('soc-alumne-card');
    var fieldsSoc = document.getElementById('soc-alumne-fields');
    var hiddenChkSoc = document.getElementById('chk-soc-alumne');

    var checkVal = document.getElementById('check-val-regal');
    var cardVal = document.getElementById('val-regal-card');
    var fieldsVal = document.getElementById('val-regal-fields');
    var hiddenChkVal = document.getElementById('chk-val-regal');

    function toggleSoc(active) {
      if (checkSoc) checkSoc.checked = active;
      if (hiddenChkSoc) hiddenChkSoc.checked = active;
      if (fieldsSoc) fieldsSoc.style.display = active ? 'block' : 'none';
      if (cardSoc) {
        cardSoc.style.borderColor = active ? 'var(--primary)' : '#E5DDD5';
        cardSoc.style.background = active ? '#FFF8F6' : '#FAF7F5';
      }
      if (!active) clearStudent();
    }
    window.toggleSocAlumne = toggleSoc;

    if (checkSoc) {
      checkSoc.addEventListener('change', function() { toggleSoc(this.checked); });
    }

    // Modes de cerca
    var btnModeNom = document.getElementById('btn-mode-nom');
    var btnModeNum = document.getElementById('btn-mode-num');
    var panNom = document.getElementById('panel-alumne-nom');
    var panNum = document.getElementById('panel-alumne-num');

    if (btnModeNom && btnModeNum) {
      btnModeNom.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        btnModeNom.style.borderColor = 'var(--primary)';
        btnModeNom.style.background = '#FFF8F6';
        btnModeNom.style.color = 'var(--primary)';
        btnModeNum.style.borderColor = '#D6C7BC';
        btnModeNum.style.background = '#FFF';
        btnModeNum.style.color = 'var(--dark)';
        if (panNom) panNom.style.display = 'block';
        if (panNum) panNum.style.display = 'none';
      });

      btnModeNum.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        btnModeNum.style.borderColor = 'var(--primary)';
        btnModeNum.style.background = '#FFF8F6';
        btnModeNum.style.color = 'var(--primary)';
        btnModeNom.style.borderColor = '#D6C7BC';
        btnModeNom.style.background = '#FFF';
        btnModeNom.style.color = 'var(--dark)';
        if (panNum) panNum.style.display = 'block';
        if (panNom) panNom.style.display = 'none';
      });
    }

    async function verifyStudent(query, errEl) {
      if (!query) {
        if (errEl) { errEl.textContent = 'Si us plau, escriu una dada per cercar.'; errEl.style.display = 'block'; }
        return;
      }
      if (errEl) errEl.style.display = 'none';
      try {
        var apiBase = getWebApiBase();
        var res = await fetch(apiBase + '/api/alumnes/verificar?q=' + encodeURIComponent(query));
        var data = await res.json();
        if (data && data.ok && data.found && data.alumne) {
          applyStudent(data.alumne);
        } else {
          if (errEl) {
            errEl.textContent = 'No hem trobat cap alumne amb aquesta dada. Pots omplir les teves dades a sota.';
            errEl.style.display = 'block';
          }
        }
      } catch(err) {
        console.warn('Error verificant:', err);
      }
    }

    function applyStudent(al) {
      var nomIn = document.getElementById('client-nom');
      var telIn = document.getElementById('client-tel');
      var emIn = document.getElementById('client-email');
      if (nomIn && al.nom) nomIn.value = al.nom;
      if (telIn && al.telefon) telIn.value = al.telefon;
      if (emIn && al.email) emIn.value = al.email;

      var alertBox = document.getElementById('alumne-identificat-alert');
      var nomDisp = document.getElementById('alumne-nom-display');
      var idDisp = document.getElementById('alumne-id-display');
      if (nomDisp) nomDisp.textContent = al.nom;
      if (idDisp) idDisp.textContent = al.id;
      if (alertBox) alertBox.style.display = 'flex';

      window._identifiedStudent = al;
    }

    function clearStudent() {
      var alertBox = document.getElementById('alumne-identificat-alert');
      if (alertBox) alertBox.style.display = 'none';
      window._identifiedStudent = null;
    }

    var btnCercarNom = document.getElementById('btn-cercar-nom');
    if (btnCercarNom) {
      btnCercarNom.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        verifyStudent((document.getElementById('input-student-name') ? document.getElementById('input-student-name').value : '').trim(), document.getElementById('student-name-error'));
      });
    }

    var inputStudentName = document.getElementById('input-student-name');
    if (inputStudentName) {
      inputStudentName.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          verifyStudent((this.value || '').trim(), document.getElementById('student-name-error'));
        }
      });
    }

    var btnCercarNum = document.getElementById('btn-cercar-num');
    if (btnCercarNum) {
      btnCercarNum.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        verifyStudent((document.getElementById('input-student-num') ? document.getElementById('input-student-num').value : '').trim(), document.getElementById('student-num-error'));
      });
    }

    var inputStudentNum = document.getElementById('input-student-num');
    if (inputStudentNum) {
      inputStudentNum.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          verifyStudent((this.value || '').trim(), document.getElementById('student-num-error'));
        }
      });
    }

    var btnDesferAlumne = document.getElementById('btn-desfer-alumne');
    if (btnDesferAlumne) {
      btnDesferAlumne.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        clearStudent();
      });
    }

    // Val regal toggle
    function toggleVal(active) {
      if (checkVal) checkVal.checked = active;
      if (hiddenChkVal) hiddenChkVal.checked = active;
      if (fieldsVal) fieldsVal.style.display = active ? 'block' : 'none';
      if (cardVal) {
        cardVal.style.borderColor = active ? 'var(--primary)' : '#E5DDD5';
        cardVal.style.background = active ? '#FFF8F6' : '#FAF7F5';
      }
      if (active) {
        var shiftMati = document.getElementById('shift-mati');
        if (shiftMati) shiftMati.click();
      }
    }
    window.toggleValRegal = toggleVal;

    if (checkVal) {
      checkVal.addEventListener('change', function() { toggleVal(this.checked); });
    }

    // Botons activitat del val
    document.querySelectorAll('.btn-val-act').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        document.querySelectorAll('.btn-val-act').forEach(function(x) {
          x.style.borderColor = '#D6C7BC'; x.style.color = 'var(--dark)'; x.classList.remove('active');
        });
        this.style.borderColor = 'var(--primary)'; this.style.color = 'var(--primary)'; this.classList.add('active');
        var act = this.getAttribute('data-act');
        selectActivity(act);
      });
    });
  }

  /* ==== POPUPS INFORMATIUS D'ACTIVITATS (GRUPS, MONOGRÀFICS, CASALS) ==== */
  var activitatsInfoData = null;

  async function loadActivitatsInfo() {
    try {
      var apiBase = getWebApiBase();
      var res = await fetch(apiBase + '/api/activitats-info?t=' + Date.now());
      if (res.ok) {
        var data = await res.json();
        if (data && data.ok && data.info) {
          activitatsInfoData = data.info;
        }
      }
    } catch (e) {
      console.warn('Fallback activitats info');
    }
  }

  function getFallbackActInfo(type) {
    var defaults = {
      grups: {
        titol: "Activitats per a Grups i Famílies",
        subtitol: "Celebracions, aniversaris, trobades i teambuilding",
        descripcio: "Veniu en parella, família o amics a compartir una experiència al taller. Us preparem una sessió a mida i exclusiva adaptada a les vostres preferències i nivell.\n\nPodeu combinar torn de terrissaire, modelatge ceràmic o pintura sobre ceràmica.",
        detalls: "• Sessions a mida de 2 o més hores.\n• Tot el fang ceràmic, eines, davantals i materials inclosos.\n• Acompanyament personalitzat del mestre ceramista.\n• Enfornat i cocció final de totes les peces perquè us les endugueu a casa.",
        dates: "Horaris a convenir de dimecres a diumenge.",
        preu: "Preu segons el nombre de persones i durada de l'activitat.",
        whatsapp_msg: "Hola Roig de Coure! Voldria informació i disponibilitat per a un grup."
      },
      monografics: {
        titol: "Cursos Monogràfics i Intensius",
        subtitol: "Tècniques específiques de taller, esmaltat, torn avançat i peces d'autor",
        descripcio: "Cursos intensius i tallers monogràfics d'1 a 3 dies, orientats a aprofundir en aspectes concrets del món ceràmic.\n\nIdeal tant per a alumnes que volen avançar de nivell com per a creadors que volen dominar una tècnica específica.",
        detalls: "• Sessions intensives temàtiques (Raku, esmaltat, escultures, teteres...).\n• Grups reduïts per a una atenció propera i detallada.\n• Materials de primera qualitat i coccions especials incloses.",
        dates: "Programació de noves convocatòries periòdiques. Consulta'ns les pròximes dates disponibles!",
        preu: "Segons la durada i la temàtica del monogràfic.",
        whatsapp_msg: "Hola Roig de Coure! Voldria informació sobre els pròxims cursos monogràfics programats."
      },
      casals: {
        titol: "Casals de Ceràmica per a Infants",
        subtitol: "Creativitat, argila i diversió durant les vacances escolars",
        descripcio: "Casals de ceràmica per a infants i joves durant les vacances d'estiu, Setmana Santa i Nadal.\n\nUn espai segur, inspirador i artístic on aprendre la màgia de transformar el fang amb les mans, provar el torn elèctric i pintar les seves pròpies creacions.",
        detalls: "• Torn elèctric adaptat, modelatge manual i pintura creativa.\n• Monitors i ceramistes amb experiència pedagògica.\n• Totes les peces es couen al forn perquè se les enduguin com a record permanent.",
        dates: "Vacances d'estiu (juliol i agost), Setmana Santa i vacances de Nadal.",
        preu: "Inscripcions per setmanes o dies solts.",
        whatsapp_msg: "Hola Roig de Coure! Voldria informació sobre els casals infantils de ceràmica."
      }
    };
    return defaults[type] || defaults.grups;
  }

  function openActInfoModal(type) {
    var modal = document.getElementById('modal-activitat-info');
    if (!modal) return;
    var info = (activitatsInfoData && activitatsInfoData[type]) ? activitatsInfoData[type] : getFallbackActInfo(type);

    var titleEl = document.getElementById('modal-act-info-title');
    var subEl = document.getElementById('modal-act-info-subtitle');
    var badgeEl = document.getElementById('modal-act-info-badge');
    var bodyEl = document.getElementById('modal-act-info-body');
    var waBtn = document.getElementById('modal-act-info-wa-btn');

    if (badgeEl) {
      if (type === 'grups') badgeEl.textContent = 'Grups i Famílies';
      else if (type === 'monografics') badgeEl.textContent = 'Cursos Monogràfics';
      else if (type === 'casals') badgeEl.textContent = 'Casals Infantils';
    }
    if (titleEl) titleEl.textContent = info.titol || '';
    if (subEl) subEl.textContent = info.subtitol || '';

    var html = '';
    if (info.descripcio) {
      html += '<div style="margin-bottom: 16px; white-space: pre-line;">' + esc(info.descripcio) + '</div>';
    }
    if (info.detalls) {
      html += '<div style="background: #FAF7F5; border: 1.5px solid #EAD8CE; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px;">';
      html += '<div style="font-weight: 700; color: #831D1D; font-size: 13px; margin-bottom: 8px;">Què inclou i característiques:</div>';
      html += '<div style="white-space: pre-line; font-size: 13.5px; color: #4B5563; line-height: 1.6;">' + esc(info.detalls) + '</div>';
      html += '</div>';
    }
    if (info.dates || info.preu) {
      html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">';
      if (info.dates) {
        html += '<div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; font-size: 13px;">';
        html += '<strong style="display: block; color: #111827; margin-bottom: 3px; font-size: 12.5px;">Dates i Programació:</strong>';
        html += '<span style="color: #4B5563;">' + esc(info.dates) + '</span></div>';
      }
      if (info.preu) {
        html += '<div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; font-size: 13px;">';
        html += '<strong style="display: block; color: #111827; margin-bottom: 3px; font-size: 12.5px;">Preus i Condicions:</strong>';
        html += '<span style="color: #4B5563;">' + esc(info.preu) + '</span></div>';
      }
      html += '</div>';
    }
    if (bodyEl) bodyEl.innerHTML = html;

    if (waBtn) {
      var msg = info.whatsapp_msg || ('Hola Roig de Coure! Voldria informació sobre ' + (info.titol || 'aquesta activitat') + '.');
      waBtn.href = 'https://wa.me/' + CFG.phone + '?text=' + encodeURIComponent(msg);
    }

    modal.classList.add('active');
  }
  window.openActInfoModal = openActInfoModal;

  function closeActInfoModal() {
    var modal = document.getElementById('modal-activitat-info');
    if (modal) modal.classList.remove('active');
  }
  window.closeActInfoModal = closeActInfoModal;

  function initActivitatsInfoPopups() {
    loadActivitatsInfo();
    document.querySelectorAll('[data-info-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var actType = this.getAttribute('data-info-act');
        openActInfoModal(actType);
      });
    });
  }

})();
