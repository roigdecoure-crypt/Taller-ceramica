/**
 * roigdecoure-web.js - Motor interactiu contemporani per a Roig de Coure
 * Gestor de fons fixes dinàmics + informació flotant amb reveal suau.
 * Zero emojis. 100% autèntic Roig de Coure.
 */

(function () {
  'use strict';

  // 1. CONFIGURACIO OFICIAL DEL TALLER
  const CFG = {
    phone: '34683633880',
    email: 'roigdecoure@gmail.com',
    capacities: {
      torn: 4,
      modelatge: 8,
      pintar: 12,
      vidre: 6
    },
    names: {
      torn: 'Torn',
      modelatge: 'Modelatge',
      pintar: 'Pintar Ceràmica',
      vidre: 'Fusió de Vidre'
    },
    monthNames: [
      'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
      'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'
    ],
    closedWeekdays: [1, 2] // Dilluns (1) i Dimarts (2) descans i fornejades
  };

  // Estat global de la reserva
  const state = {
    activity: 'torn',
    date: null,
    shift: 'mati',
    time: '10:00',
    persons: 1,
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth()
  };

  // Inicialització al carregar el DOM
  document.addEventListener('DOMContentLoaded', function () {
    initBackdropSwitcher();
    initScrollReveals();
    initHeaderScroll();
    initMobileNav();
    initActivitySelector();
    initCalendarWidget();
    initShiftSelector();
    initBookingForm();
    initFaqAccordion();
    initModalEvents();
  });

  /* ==========================================================================
     2. GESTOR DE FONS FIXES (CANVI SUAU DE FOTOGRAFIA AMB L'SCROLL)
     ========================================================================== */
  function initBackdropSwitcher() {
    const slides = document.querySelectorAll('.backdrop-slide');
    const steps = document.querySelectorAll('.scroll-step');
    if (!slides.length || !steps.length) return;

    function updateActiveBackdrop() {
      const triggerY = window.innerHeight * 0.45;
      let currentBgIndex = 0;

      steps.forEach(function (step) {
        const rect = step.getBoundingClientRect();
        if (rect.top <= triggerY && rect.bottom >= triggerY) {
          const idx = parseInt(step.getAttribute('data-bg-index'), 10);
          if (!isNaN(idx)) {
            currentBgIndex = idx;
          }
        }
      });

      slides.forEach(function (slide, i) {
        slide.classList.toggle('active', i === currentBgIndex);
      });
    }

    window.addEventListener('scroll', updateActiveBackdrop, { passive: true });
    window.addEventListener('resize', updateActiveBackdrop, { passive: true });
    updateActiveBackdrop();
  }

  /* ==========================================================================
     3. REVEAL SUAU DELS PANELLS FLOTANTS
     ========================================================================== */
  function initScrollReveals() {
    const items = document.querySelectorAll('.reveal-item');
    if (!items.length) return;

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, {
        threshold: 0.08,
        rootMargin: '0px 0px -30px 0px'
      });

      items.forEach(function (el) {
        observer.observe(el);
      });
    } else {
      items.forEach(function (el) {
        el.classList.add('is-visible');
      });
    }
  }

  /* ==========================================================================
     4. HEADER SCROLL & MOBIL DRAWER
     ========================================================================== */
  function initHeaderScroll() {
    const header = document.getElementById('siteHeader');
    if (!header) return;

    window.addEventListener('scroll', function () {
      if (window.scrollY > 30) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  function initMobileNav() {
    const toggle = document.getElementById('mobileToggle');
    const drawer = document.getElementById('mobileDrawer');
    if (!toggle || !drawer) return;

    toggle.addEventListener('click', function () {
      drawer.classList.toggle('open');
    });

    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        drawer.classList.remove('open');
      });
    });
  }

  /* ==========================================================================
     5. SELECTOR D'ACTIVITATS I ENLLAÇOS DIRECTES
     ========================================================================== */
  function initActivitySelector() {
    const chips = document.querySelectorAll('.chip-select-btn');
    chips.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectActivity(this.getAttribute('data-act'));
      });
    });

    const cardLinks = document.querySelectorAll('.select-act-link');
    cardLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        const act = this.getAttribute('data-act');
        if (act) selectActivity(act);
      });
    });
  }

  function selectActivity(act) {
    if (!CFG.names[act]) return;
    state.activity = act;

    document.querySelectorAll('.chip-select-btn').forEach(function (btn) {
      btn.classList.toggle('selected', btn.getAttribute('data-act') === act);
    });

    const numSelect = document.getElementById('numPersonsSelect');
    if (numSelect) {
      const max = CFG.capacities[act] || 4;
      numSelect.innerHTML = '';
      for (let i = 1; i <= max; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i + (i === 1 ? ' persona' : ' persones') + (i === max ? ' (aforament màxim)' : '');
        numSelect.appendChild(opt);
      }
      if (state.persons > max) state.persons = max;
      numSelect.value = state.persons;
    }

    updateSummary();
  }

  /* ==========================================================================
     6. CALENDARI INTERACTIU (OBERTS DC A DG, DL I DT TANCATS)
     ========================================================================== */
  function initCalendarWidget() {
    renderCalendar(state.calYear, state.calMonth);

    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        state.calMonth--;
        if (state.calMonth < 0) {
          state.calMonth = 11;
          state.calYear--;
        }
        renderCalendar(state.calYear, state.calMonth);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        state.calMonth++;
        if (state.calMonth > 11) {
          state.calMonth = 0;
          state.calYear++;
        }
        renderCalendar(state.calYear, state.calMonth);
      });
    }

    selectNextAvailableDay();
  }

  function selectNextAvailableDay() {
    const today = new Date();
    for (let offset = 1; offset <= 14; offset++) {
      const test = new Date(today);
      test.setDate(today.getDate() + offset);
      const dayOfWeek = test.getDay(); // 0=Dg, 1=Dl, 2=Dt, 3=Dc...
      if (!CFG.closedWeekdays.includes(dayOfWeek)) {
        const y = test.getFullYear();
        const m = String(test.getMonth() + 1).padStart(2, '0');
        const d = String(test.getDate()).padStart(2, '0');
        state.date = y + '-' + m + '-' + d;
        state.calYear = test.getFullYear();
        state.calMonth = test.getMonth();
        renderCalendar(state.calYear, state.calMonth);
        updateSummary();
        break;
      }
    }
  }

  function renderCalendar(year, month) {
    const titleEl = document.getElementById('calendarMonthYear');
    if (titleEl) {
      titleEl.textContent = CFG.monthNames[month] + ' ' + year;
    }

    const gridEl = document.getElementById('calDaysGrid');
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    let startDayIndex = firstDay.getDay() - 1;
    if (startDayIndex === -1) startDayIndex = 6;

    for (let i = 0; i < startDayIndex; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day-cell empty';
      gridEl.appendChild(empty);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell';
      cell.textContent = day;

      const cellDate = new Date(year, month, day);
      cellDate.setHours(0, 0, 0, 0);
      const dayOfWeek = cellDate.getDay();
      const dateString = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');

      if (cellDate < today) {
        cell.classList.add('disabled');
      } else if (CFG.closedWeekdays.includes(dayOfWeek)) {
        cell.classList.add('closed');
        cell.title = 'Tancat per fornejades i descans';
      } else {
        cell.classList.add('available');
        if (state.date === dateString) {
          cell.classList.add('selected');
        }

        cell.addEventListener('click', function () {
          document.querySelectorAll('.cal-day-cell').forEach(function (c) {
            c.classList.remove('selected');
          });
          cell.classList.add('selected');
          state.date = dateString;
          updateSummary();
        });
      }

      gridEl.appendChild(cell);
    }
  }

  /* ==========================================================================
     7. SELECTOR DE TORNS I HORARIS
     ========================================================================== */
  function initShiftSelector() {
    const shiftMati = document.getElementById('shiftMati');
    const shiftTarda = document.getElementById('shiftTarda');

    if (shiftMati) {
      shiftMati.addEventListener('click', function (e) {
        if (e.target.tagName !== 'INPUT') {
          const radio = shiftMati.querySelector('input[type="radio"]:checked') || shiftMati.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;
        }
        setShift('mati');
      });
    }

    if (shiftTarda) {
      shiftTarda.addEventListener('click', function (e) {
        if (e.target.tagName !== 'INPUT') {
          const radio = shiftTarda.querySelector('input[type="radio"]:checked') || shiftTarda.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;
        }
        setShift('tarda');
      });
    }

    document.querySelectorAll('input[name="horaEntrada"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        state.time = this.value;
        if (this.value.startsWith('10') || this.value.startsWith('11')) {
          setShift('mati');
        } else {
          setShift('tarda');
        }
        updateSummary();
      });
    });

    const numSelect = document.getElementById('numPersonsSelect');
    if (numSelect) {
      numSelect.addEventListener('change', function () {
        state.persons = parseInt(this.value, 10);
        updateSummary();
      });
    }
  }

  function setShift(shift) {
    state.shift = shift;
    const shiftMati = document.getElementById('shiftMati');
    const shiftTarda = document.getElementById('shiftTarda');

    if (shift === 'mati') {
      if (shiftMati) shiftMati.classList.add('selected');
      if (shiftTarda) shiftTarda.classList.remove('selected');
      const radio = shiftMati ? shiftMati.querySelector('input[type="radio"]:checked') : null;
      state.time = radio ? radio.value : '10:00';
    } else {
      if (shiftTarda) shiftTarda.classList.add('selected');
      if (shiftMati) shiftMati.classList.remove('selected');
      const radio = shiftTarda ? shiftTarda.querySelector('input[type="radio"]:checked') : null;
      state.time = radio ? radio.value : '17:00';
    }
    updateSummary();
  }

  function updateSummary() {
    const actEl = document.getElementById('sumActivity');
    const dateEl = document.getElementById('sumDate');
    const shiftEl = document.getElementById('sumShift');

    if (actEl) actEl.textContent = CFG.names[state.activity] || 'Torn';
    if (dateEl) {
      if (state.date) {
        const parts = state.date.split('-');
        dateEl.textContent = parts[2] + ' / ' + parts[1] + ' / ' + parts[0];
      } else {
        dateEl.textContent = 'Selecciona un dia al calendari';
      }
    }
    if (shiftEl) {
      const shiftName = state.shift === 'mati' ? 'Matí' : 'Tarda';
      shiftEl.textContent = shiftName + ' (' + state.time + ' h) · ' + state.persons + (state.persons === 1 ? ' persona' : ' persones');
    }
  }

  /* ==========================================================================
     8. GESTIO DEL FORMULARI DE RESERVA & WHATSAPP
     ========================================================================== */
  function initBookingForm() {
    const form = document.getElementById('bookingForm');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!state.date) {
        alert('Si us plau, selecciona una data disponible al calendari (obert de dimecres a diumenge).');
        return;
      }

      const name = document.getElementById('clientName').value.trim();
      const phone = document.getElementById('clientPhone').value.trim();
      const email = document.getElementById('clientEmail').value.trim();
      const notes = document.getElementById('clientNotes').value.trim();

      if (!name || !phone || !email) {
        alert('Si us plau, omple les teves dades de contacte (nom, telèfon i correu).');
        return;
      }

      const actName = CFG.names[state.activity];
      const dateFormatted = state.date.split('-').reverse().join('/');
      const shiftName = state.shift === 'mati' ? 'Matí' : 'Tarda';

      let msg = 'Hola Ferran, m'agradaria reservar plaça al taller de Roig de Coure:

';
      msg += '- Disciplina: ' + actName + '
';
      msg += '- Data: ' + dateFormatted + '
';
      msg += '- Torn: ' + shiftName + ' (Arribada a les ' + state.time + ' h)
';
      msg += '- Places: ' + state.persons + '
';
      msg += '- Nom: ' + name + '
';
      msg += '- Telèfon: ' + phone + '
';
      msg += '- Correu: ' + email + '
';
      if (notes) {
        msg += '- Observacions: ' + notes + '
';
      }
      msg += '
Gràcies!';

      const waUrl = 'https://wa.me/' + CFG.phone + '?text=' + encodeURIComponent(msg);

      const modal = document.getElementById('confirmModal');
      const modalContent = document.getElementById('modalSummaryContent');
      const waBtn = document.getElementById('modalWhatsAppBtn');

      if (modalContent) {
        modalContent.textContent = 'Molt bé, ' + name + '! Hem registrat la teva sol·licitud per a ' + actName + ' el dia ' + dateFormatted + ' a les ' + state.time + ' h (' + state.persons + ' places). Pots enviar la confirmació directa per WhatsApp al taller per accelerar la gestió de la teva plaça:';
      }

      if (waBtn) {
        waBtn.href = waUrl;
      }

      if (modal) {
        modal.classList.add('active');
      }
    });
  }

  function initModalEvents() {
    const modal = document.getElementById('confirmModal');
    const closeBtn = document.getElementById('modalCloseBtn');
    const doneBtn = document.getElementById('modalDoneBtn');

    function closeModal() {
      if (modal) modal.classList.remove('active');
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
    }
  }

  /* ==========================================================================
     9. PREGUNTES FREQUENTS (FAQ ACORDIO)
     ========================================================================== */
  function initFaqAccordion() {
    const items = document.querySelectorAll('.faq-accordion-item');
    items.forEach(function (card) {
      const btn = card.querySelector('.faq-accordion-btn');
      if (!btn) return;

      btn.addEventListener('click', function () {
        const isOpen = card.classList.contains('open');

        items.forEach(function (other) {
          other.classList.remove('open');
        });

        if (!isOpen) {
          card.classList.add('open');
        }
      });
    });
  }

})();
