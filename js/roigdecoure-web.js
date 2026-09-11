/**
 * roigdecoure-web.js - Motor interactiu trencador per a Roig de Coure
 * Scroll reveals, parallax hero, reserves en viu, val regal, FAQ
 */
(function () {
  'use strict';

  const CFG = {
    phone: '34683633880',
    email: 'roigdecoure@gmail.com',
    capacities: { torn: 4, modelatge: 8, pintar: 12, vidre: 6 },
    names: { torn: 'Torn', modelatge: 'Modelatge', pintar: 'Pintar Ceramica', vidre: 'Fusio de Vidre' },
    closedWeekdays: [1, 2]
  };

  const booking = {
    activity: 'torn', numPersons: 1, date: null, shift: 'mati', arrivalTime: '10:00',
    currentMonth: new Date().getMonth(), currentYear: new Date().getFullYear()
  };

  document.addEventListener('DOMContentLoaded', function () {
    initScrollReveals();
    initHeroBackgroundSlider();
    initNavigation();
    initBookingEngine();
    initGiftVoucher();
    initFaqAccordion();
    initContactForm();
  });

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
  function initBookingEngine() {
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
        if (arr) { arr.value = booking.shift === 'mati' ? '10:00' : '17:00'; booking.arrivalTime = arr.value; }
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
        if (data.ok && data.franges) {
          var fm = data.franges.find(function (f) { return f.id === 'mati'; });
          var ft = data.franges.find(function (f) { return f.id === 'tarda'; });
          sm.textContent = (fm ? fm.disponibles : max) + ' places disponibles';
          st.textContent = (ft ? ft.disponibles : max) + ' places disponibles';
          return;
        }
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

  function showModal(d) {
    var modal = document.getElementById('booking-modal');
    var content = document.getElementById('modal-summary-content');
    var waBtn = document.getElementById('modal-wa-btn');
    if (!modal) return;
    if (content) content.innerHTML =
      '<div style="background:#FBF4F2;border:1px solid #E8E1DA;border-radius:8px;padding:16px;margin:16px 0;font-size:14px;line-height:1.6;">' +
      '<p><strong>Titular:</strong> ' + esc(d.nom) + '</p>' +
      '<p><strong>Activitat:</strong> ' + esc(d.act) + '</p>' +
      '<p><strong>Places:</strong> ' + d.places + '</p>' +
      '<p><strong>Data:</strong> ' + esc(d.data) + '</p>' +
      '<p><strong>Torn:</strong> ' + esc(d.torn) + ' (Arribada ' + d.hora + 'h)</p>' +
      (d.val ? '<p><strong>Val Regal:</strong> ' + esc(d.val) + '</p>' : '') +
      '<p style="margin-top:8px;font-size:12px;color:#787069;">Ref: <code>' + esc(d.id) + '</code></p></div>';
    if (waBtn) {
      var t = encodeURIComponent('Hola Roig de Coure! Reserva:\n- ' + d.act + '\n- Data: ' + d.data +
        '\n- Torn: ' + d.torn + ' (' + d.hora + 'h)\n- Places: ' + d.places + '\n- Nom: ' + d.nom + '\n- Tel: ' + d.tel);
      waBtn.href = 'https://wa.me/' + CFG.phone + '?text=' + t;
    }
    modal.classList.add('active');
    var close = document.getElementById('modal-close-btn');
    if (close) close.onclick = function () { modal.classList.remove('active'); };
  }

  /* ==== VAL REGAL ==== */
  const STRIPE_GIFT_URLS = {
    'torn': 'https://buy.stripe.com/3cI14n2BHdPH0KKg5vgIo0m',           // Experiència torn o modelatge adults
    'torn-infant': 'https://buy.stripe.com/6oUeVd1xDbHzbpof1rgIo0k',    // Experiència torn o modelatge <= 12 anys
    'pintar': 'https://buy.stripe.com/aFacN5ekpfXPdxw8D3gIo0o',         // Regalar Experiències / Pintar
    'hores-adults': 'https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n',   // Hores de taller Adults
    'hores-infant': 'https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j'    // Hores de taller <= 12 anys
  };

  function initGiftVoucher() {
    var expSel = document.getElementById('gift-exp-select');
    var prevExp = document.getElementById('preview-gift-exp');
    var prevCode = document.getElementById('preview-gift-code');

    function upd() {
      if (prevExp && expSel) prevExp.textContent = expSel.options[expSel.selectedIndex].text;
    }

    if (expSel) expSel.addEventListener('change', upd);
    if (prevCode) prevCode.textContent = 'RDC-' + new Date().getFullYear() + '-' + (1000 + Math.floor(Math.random() * 9000));

    var payBtn = document.getElementById('gift-pay-btn');
    if (payBtn) payBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var selVal = (expSel && expSel.value) || 'torn';
      var stripeUrl = STRIPE_GIFT_URLS[selVal] || STRIPE_GIFT_URLS['torn'];
      window.open(stripeUrl, '_blank');
    });
    upd();
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
})();
