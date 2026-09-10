/**
 * roigdecoure-web.js - Motor interactiu contemporani per a Roig de Coure
 * Floating action dock, 3D tilt suau al hero, stepper de reserves fluid,
 * passarel·la Stripe per a Val Regal, FAQ acordió i modal de confirmació.
 */
(function () {
  'use strict';

  const CFG = {
    phone: '34683633880',
    email: 'roigdecoure@gmail.com',
    capacities: { torn: 4, modelatge: 8, pintar: 12, vidre: 6 },
    names: { torn: 'Torn', modelatge: 'Modelatge', pintar: 'Pintar Ceràmica', vidre: 'Fusió de Vidre' },
    closedWeekdays: [1, 2] // Dilluns (1) i Dimarts (2) descans
  };

  const STRIPE_GIFT_URLS = {
    'torn': 'https://buy.stripe.com/3cI14n2BHdPH0KKg5vgIo0m',           // Experiència torn o modelatge adults
    'torn-infant': 'https://buy.stripe.com/6oUeVd1xDbHzbpof1rgIo0k',    // Experiència torn o modelatge <= 12 anys
    'pintar': 'https://buy.stripe.com/aFacN5ekpfXPdxw8D3gIo0o',         // Regalar Experiències / Pintar
    'hores-adults': 'https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n',   // Hores de taller Adults
    'hores-infant': 'https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j'    // Hores de taller <= 12 anys
  };

  const booking = {
    activity: 'torn',
    numPersons: 1,
    date: null,
    shift: 'mati',
    arrivalTime: '10:00',
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear()
  };

  document.addEventListener('DOMContentLoaded', function () {
    initNavigation();
    initHeroTilt();
    initFloatingDock();
    initBookingEngine();
    initGiftVoucher();
    initFaqAccordion();
  });

  /* ==========================================================================
     1. NAVEGACIÓ & DOCK FLOTANT
     ========================================================================== */
  function initNavigation() {
    var header = document.getElementById('site-header');
    var toggle = document.getElementById('menu-toggle');

    window.addEventListener('scroll', function () {
      if (header) {
        header.classList.toggle('scrolled', window.scrollY > 40);
      }
      updateActiveNavLink();
    }, { passive: true });

    if (toggle) {
      toggle.addEventListener('click', function () {
        document.body.classList.toggle('nav-mobile-active');
        this.setAttribute('aria-expanded', document.body.classList.contains('nav-mobile-active'));
      });
    }

    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        document.body.classList.remove('nav-mobile-active');
      });
    });

    // Enllaços ràpids a activitat des de les targetes
    document.querySelectorAll('[data-book-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var act = this.getAttribute('data-book-act');
        selectActivity(act);
        var sec = document.getElementById('reserves');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function updateActiveNavLink() {
    var sections = ['inici', 'activitats', 'reserves', 'val-regal', 'tarifes', 'faq', 'contacte'];
    var current = '';
    sections.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && window.scrollY >= el.offsetTop - 140) {
        current = id;
      }
    });
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  }

  function initFloatingDock() {
    var dock = document.getElementById('floating-dock');
    if (!dock) return;
    window.addEventListener('scroll', function () {
      dock.classList.toggle('visible', window.scrollY > 420);
    }, { passive: true });
  }

  /* ==========================================================================
     2. PARALLAX / 3D TILT AL HERO (INTERACCIÓ FLUIDA DE RATOLÍ)
     ========================================================================== */
  function initHeroTilt() {
    var frame = document.getElementById('hero-frame');
    if (!frame || window.innerWidth < 980) return;

    frame.addEventListener('mousemove', function (e) {
      var rect = frame.getBoundingClientRect();
      var x = e.clientX - rect.left - rect.width / 2;
      var y = e.clientY - rect.top - rect.height / 2;
      var rotateX = -(y / rect.height) * 10;
      var rotateY = (x / rect.width) * 10;
      frame.style.transform = 'perspective(1000px) rotateX(' + rotateX.toFixed(2) + 'deg) rotateY(' + rotateY.toFixed(2) + 'deg) scale(1.02)';
    });

    frame.addEventListener('mouseleave', function () {
      frame.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
    });
  }

  /* ==========================================================================
     3. MOTOR DE RESERVES (STEPPER 2.0)
     ========================================================================== */
  function initBookingEngine() {
    // Selectors segmentats
    document.querySelectorAll('.segment-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectActivity(this.getAttribute('data-act'));
      });
    });

    // Selector places
    var personsSel = document.getElementById('booking-persons');
    if (personsSel) {
      personsSel.addEventListener('change', function () {
        booking.numPersons = parseInt(this.value) || 1;
        updateShiftSpots();
      });
    }

    // Navegació calendari
    var prevBtn = document.getElementById('cal-prev-btn');
    var nextBtn = document.getElementById('cal-next-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        var now = new Date();
        var pm = booking.currentMonth - 1;
        var py = pm < 0 ? booking.currentYear - 1 : booking.currentYear;
        if (py < now.getFullYear() || (py === now.getFullYear() && (pm < 0 ? 11 : pm) < now.getMonth())) return;
        booking.currentMonth = pm < 0 ? 11 : pm;
        booking.currentYear = py;
        renderCalendar();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var nm = booking.currentMonth + 1;
        booking.currentMonth = nm > 11 ? 0 : nm;
        booking.currentYear = nm > 11 ? booking.currentYear + 1 : booking.currentYear;
        renderCalendar();
      });
    }

    // Torns Matí / Tarda
    document.querySelectorAll('.shift-pill-card').forEach(function (card) {
      card.addEventListener('click', function () {
        if (this.classList.contains('disabled')) return;
        document.querySelectorAll('.shift-pill-card').forEach(function (c) { c.classList.remove('selected'); });
        this.classList.add('selected');
        booking.shift = this.getAttribute('data-shift');
        var arr = document.getElementById('booking-arrival-time');
        if (arr) {
          arr.value = booking.shift === 'mati' ? '10:00' : '17:00';
          booking.arrivalTime = arr.value;
        }
      });
    });

    var arrSel = document.getElementById('booking-arrival-time');
    if (arrSel) {
      arrSel.addEventListener('change', function () {
        booking.arrivalTime = this.value;
      });
    }

    // Opcions addicionals
    var chkVal = document.getElementById('chk-val-regal');
    var valWrap = document.getElementById('val-code-wrap');
    if (chkVal && valWrap) {
      chkVal.addEventListener('change', function () { valWrap.style.display = this.checked ? 'block' : 'none'; });
    }

    var chkAlu = document.getElementById('chk-soc-alumne');
    var aluWrap = document.getElementById('alumne-code-wrap');
    if (chkAlu && aluWrap) {
      chkAlu.addEventListener('change', function () { aluWrap.style.display = this.checked ? 'block' : 'none'; });
    }

    var form = document.getElementById('public-booking-form');
    if (form) form.addEventListener('submit', handleBookingSubmit);

    selectInitialDate();
    renderCalendar();
  }

  function selectActivity(act) {
    if (!CFG.capacities[act]) return;
    booking.activity = act;
    document.querySelectorAll('.segment-btn').forEach(function (b) {
      b.classList.toggle('selected', b.getAttribute('data-act') === act);
    });

    var max = CFG.capacities[act];
    var sel = document.getElementById('booking-persons');
    if (sel) {
      var cur = Math.min(parseInt(sel.value) || 1, max);
      sel.innerHTML = '';
      for (var i = 1; i <= max; i++) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i === 1 ? '1 persona' : i + ' persones';
        if (i === cur) opt.selected = true;
        sel.appendChild(opt);
      }
      booking.numPersons = cur;
    }
    renderCalendar();
    updateShiftSpots();
  }

  function selectInitialDate() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
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

    var mNames = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];
    titleEl.textContent = mNames[booking.currentMonth] + ' ' + booking.currentYear;
    grid.innerHTML = '';

    var firstDay = new Date(booking.currentYear, booking.currentMonth, 1).getDay();
    var offset = firstDay === 0 ? 6 : firstDay - 1;
    var total = new Date(booking.currentYear, booking.currentMonth + 1, 0).getDate();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    for (var i = 0; i < offset; i++) {
      var e = document.createElement('div');
      e.className = 'cal-day empty';
      grid.appendChild(e);
    }

    for (var day = 1; day <= total; day++) {
      var dateObj = new Date(booking.currentYear, booking.currentMonth, day);
      var ds = fmtDate(dateObj);
      var cell = document.createElement('div');
      cell.className = 'cal-day';
      cell.textContent = day;

      if (dateObj < today) {
        cell.classList.add('disabled');
      } else if (CFG.closedWeekdays.includes(dateObj.getDay())) {
        cell.classList.add('closed-day');
        cell.title = 'Tancat per fornejades';
      } else {
        cell.classList.add('available');
        if (booking.date === ds) cell.classList.add('selected');
        (function (d) {
          cell.addEventListener('click', function () {
            booking.date = d;
            renderCalendar();
            updateShiftSpots();
          });
        })(ds);
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
    var dn = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
    var mn = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
    el.textContent = dn[d.getDay()] + ', ' + p[2] + ' de ' + mn[d.getMonth()];
  }

  async function updateShiftSpots() {
    var sm = document.getElementById('spots-mati');
    var st = document.getElementById('spots-tarda');
    var max = CFG.capacities[booking.activity] || 4;
    if (!sm || !st || !booking.date) return;

    try {
      var res = await fetch('/api/reserves/disponibilitat?data=' + booking.date + '&activitat=' + booking.activity);
      if (res.ok) {
        var data = await res.json();
        if (data.ok && data.franges) {
          var fm = data.franges.find(function (f) { return f.id === 'mati'; });
          var ft = data.franges.find(function (f) { return f.id === 'tarda'; });
          sm.textContent = (fm ? fm.disponibles : max) + ' lliures';
          st.textContent = (ft ? ft.disponibles : max) + ' lliures';
          return;
        }
      }
    } catch (e) { /* offline */ }

    sm.textContent = max + ' lliures';
    st.textContent = max + ' lliures';
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

    nom = nom.trim();
    tel = tel.trim();
    if (!nom || !tel) {
      alert('Si us plau, indica el teu nom i telèfon.');
      return;
    }
    if (!booking.date) {
      alert('Selecciona un dia al calendari.');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Tramitant reserva...';
    }

    var payload = {
      activitat_id: booking.activity,
      activitat: CFG.names[booking.activity],
      places: booking.numPersons,
      data: booking.date,
      franja_id: booking.shift,
      hora_inici: booking.arrivalTime,
      nom: nom,
      telefon: tel,
      email: email.trim(),
      notes: notes.trim(),
      val_regal: isVal ? 1 : 0,
      codi_val_regal: valCode.trim(),
      soc_alumne: isAlu ? 1 : 0,
      student_id: aluId.trim()
    };

    try {
      var res = await fetch('/api/reserves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var r = await res.json();
      if (res.ok && r.ok) {
        showModal({
          nom: nom,
          tel: tel,
          act: CFG.names[booking.activity],
          places: booking.numPersons,
          data: booking.date,
          torn: booking.shift === 'mati' ? 'Matí (10-13h)' : 'Tarda (17-20h)',
          hora: booking.arrivalTime,
          val: isVal ? (valCode || 'Sí') : null,
          id: r.id || 'CONF-' + Date.now().toString().slice(-6)
        });
        form.reset();
      } else {
        alert(r.error || 'No s\'ha pogut tramitar la reserva.');
      }
    } catch (err) {
      showModal({
        nom: nom,
        tel: tel,
        act: CFG.names[booking.activity],
        places: booking.numPersons,
        data: booking.date,
        torn: booking.shift === 'mati' ? 'Matí (10-13h)' : 'Tarda (17-20h)',
        hora: booking.arrivalTime,
        val: isVal ? (valCode || 'Sí') : null,
        id: 'PENDENT-NOTIF'
      });
      form.reset();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirmar Reserva de Plaça';
      }
    }
  }

  function showModal(d) {
    var modal = document.getElementById('booking-modal');
    var content = document.getElementById('modal-summary-content');
    var waBtn = document.getElementById('modal-wa-btn');
    if (!modal) return;

    if (content) {
      content.innerHTML =
        '<div style="background:#F7F4F0;border:1px solid #E7E2DA;border-radius:12px;padding:20px;margin:16px 0;font-size:14px;line-height:1.7;">' +
        '<p><strong>Titular:</strong> ' + esc(d.nom) + '</p>' +
        '<p><strong>Activitat:</strong> ' + esc(d.act) + '</p>' +
        '<p><strong>Places:</strong> ' + d.places + '</p>' +
        '<p><strong>Data:</strong> ' + esc(d.data) + '</p>' +
        '<p><strong>Torn:</strong> ' + esc(d.torn) + ' (Arribada ' + d.hora + 'h)</p>' +
        (d.val ? '<p><strong>Val Regal:</strong> ' + esc(d.val) + '</p>' : '') +
        '<p style="margin-top:10px;font-size:12px;color:#78716C;">Ref: <code>' + esc(d.id) + '</code></p></div>';
    }

    if (waBtn) {
      var t = encodeURIComponent('Hola Roig de Coure! Reserva confirmada:\n- ' + d.act + '\n- Data: ' + d.data +
        '\n- Torn: ' + d.torn + ' (' + d.hora + 'h)\n- Places: ' + d.places + '\n- Nom: ' + d.nom + '\n- Tel: ' + d.tel);
      waBtn.href = 'https://wa.me/' + CFG.phone + '?text=' + t;
    }

    modal.classList.add('active');
    modal.onclick = function (e) {
      if (e.target === modal) modal.classList.remove('active');
    };
  }

  /* ==========================================================================
     4. VAL REGAL & STRIPE DIRECTE
     ========================================================================= */
  function initGiftVoucher() {
    var expSel = document.getElementById('gift-exp-select');
    var prevExp = document.getElementById('preview-gift-exp');
    var payBtn = document.getElementById('gift-pay-btn');

    function upd() {
      if (prevExp && expSel) {
        prevExp.textContent = expSel.options[expSel.selectedIndex].text;
      }
    }

    if (expSel) expSel.addEventListener('change', upd);

    if (payBtn) {
      payBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var selVal = (expSel && expSel.value) || 'torn';
        var stripeUrl = STRIPE_GIFT_URLS[selVal] || STRIPE_GIFT_URLS['torn'];
        window.open(stripeUrl, '_blank');
      });
    }
    upd();
  }

  /* ==========================================================================
     5. FAQ ACORDIÓ
     ========================================================================== */
  function initFaqAccordion() {
    document.querySelectorAll('.faq-row').forEach(function (row) {
      var trigger = row.querySelector('.faq-trigger');
      if (trigger) {
        trigger.addEventListener('click', function () {
          var isOpen = row.classList.contains('open');
          document.querySelectorAll('.faq-row').forEach(function (r) { r.classList.remove('open'); });
          if (!isOpen) row.classList.add('open');
        });
      }
    });
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
