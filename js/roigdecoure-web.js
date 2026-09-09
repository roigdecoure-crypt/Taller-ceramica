/**
 * roigdecoure-web.js - Lògica interactiva per a la nova web de Roig de Coure
 * Olot (Girona) - Taller de Ceràmica & Espai de Creació
 * Sense dependències de WordPress/Elementor. Rendiment ultra-ràpid. Zero emojis.
 */

(function () {
  'use strict';

  // Config oficial del taller
  const WORKSHOP_CONFIG = {
    phone: '34683633880',
    email: 'roigdecoure@gmail.com',
    address: 'Plaça Rector Ferrer, 15, 17800 Olot (Girona)',
    capacities: {
      torn: 4,
      modelatge: 8,
      pintar: 12,
      vidre: 6
    },
    names: {
      torn: 'Torn de Terrissa',
      modelatge: 'Modelatge & Escultura',
      pintar: 'Pintar Ceràmica',
      vidre: 'Fusió de Vidre'
    },
    // Dilluns (1) i Dimarts (2) descans
    closedWeekdays: [1, 2]
  };

  // Estat del motor de reserves
  const bookingState = {
    activity: 'torn',
    numPersons: 1,
    date: null,
    shift: 'mati',
    arrivalTime: '10:00',
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    availabilityCache: {}
  };

  document.addEventListener('DOMContentLoaded', function () {
    initNavigation();
    initBookingEngine();
    initGiftVoucher();
    initFaqAccordion();
    initContactForm();
  });

  /* ==========================================================================
     1. NAVEGACIÓ & HEADER
     ========================================================================== */
  function initNavigation() {
    const header = document.querySelector('.site-header');
    const menuToggle = document.getElementById('menu-toggle');
    const navLinks = document.querySelectorAll('.nav-link');

    // Scroll header styling
    window.addEventListener('scroll', function () {
      if (window.scrollY > 40) {
        header?.classList.add('scrolled');
      } else {
        header?.classList.remove('scrolled');
      }
      updateActiveNavLink();
    });

    // Mobile menu toggle
    if (menuToggle) {
      menuToggle.addEventListener('click', function () {
        document.body.classList.toggle('nav-mobile-open');
        const isOpen = document.body.classList.contains('nav-mobile-open');
        menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    }

    // Tancar menú en clicar enllaç
    navLinks.forEach(link => {
      link.addEventListener('click', function () {
        document.body.classList.remove('nav-mobile-open');
      });
    });

    // Enllaços directes des de la secció d'activitats al motor de reserves
    const actBookingBtns = document.querySelectorAll('[data-book-act]');
    actBookingBtns.forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const act = this.getAttribute('data-book-act');
        selectActivity(act);
        const bookingSection = document.getElementById('reserves');
        if (bookingSection) {
          bookingSection.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  function updateActiveNavLink() {
    const sections = ['inici', 'activitats', 'reserves', 'val-regal', 'tarifes', 'faq', 'contacte'];
    let current = '';

    sections.forEach(secId => {
      const el = document.getElementById(secId);
      if (el) {
        const top = el.offsetTop - 120;
        if (window.scrollY >= top) {
          current = secId;
        }
      }
    });

    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === '#' + current) {
        link.classList.add('active');
      }
    });
  }

  /* ==========================================================================
     2. MOTOR DE RESERVES INTEGRAT EN VIU
     ========================================================================== */
  function initBookingEngine() {
    const actButtons = document.querySelectorAll('.booking-act-btn');
    const numPersonsSelect = document.getElementById('booking-persons');
    const calPrevBtn = document.getElementById('cal-prev-btn');
    const calNextBtn = document.getElementById('cal-next-btn');
    const shiftCards = document.querySelectorAll('.shift-card');
    const bookingForm = document.getElementById('public-booking-form');

    // Selector d'activitat
    actButtons.forEach(btn => {
      btn.addEventListener('click', function () {
        const act = this.getAttribute('data-act');
        selectActivity(act);
      });
    });

    // Selector de nombre de persones
    if (numPersonsSelect) {
      numPersonsSelect.addEventListener('change', function () {
        bookingState.numPersons = parseInt(this.value, 10) || 1;
        updateShiftSpots();
      });
    }

    // Navegació de mes del calendari
    if (calPrevBtn) {
      calPrevBtn.addEventListener('click', function () {
        const now = new Date();
        const prevMonth = bookingState.currentMonth - 1;
        const prevYear = prevMonth < 0 ? bookingState.currentYear - 1 : bookingState.currentYear;
        // Evitar anar a mesos passats
        if (prevYear < now.getFullYear() || (prevYear === now.getFullYear() && prevMonth < now.getMonth())) {
          return;
        }
        bookingState.currentMonth = prevMonth < 0 ? 11 : prevMonth;
        bookingState.currentYear = prevYear;
        renderCalendar();
      });
    }

    if (calNextBtn) {
      calNextBtn.addEventListener('click', function () {
        const nextMonth = bookingState.currentMonth + 1;
        bookingState.currentMonth = nextMonth > 11 ? 0 : nextMonth;
        bookingState.currentYear = nextMonth > 11 ? bookingState.currentYear + 1 : bookingState.currentYear;
        renderCalendar();
      });
    }

    // Selector de torn (matí / tarda)
    shiftCards.forEach(card => {
      card.addEventListener('click', function () {
        if (this.classList.contains('disabled')) return;
        shiftCards.forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        bookingState.shift = this.getAttribute('data-shift');
        const arrivalSelect = document.getElementById('booking-arrival-time');
        if (arrivalSelect) {
          arrivalSelect.value = bookingState.shift === 'mati' ? '10:00' : '16:30';
          bookingState.arrivalTime = arrivalSelect.value;
        }
      });
    });

    const arrivalSelect = document.getElementById('booking-arrival-time');
    if (arrivalSelect) {
      arrivalSelect.addEventListener('change', function () {
        bookingState.arrivalTime = this.value;
      });
    }

    // Caselles opcionals de val regal i carnet alumne
    const chkValRegal = document.getElementById('chk-val-regal');
    const valCodeWrap = document.getElementById('val-code-wrap');
    if (chkValRegal && valCodeWrap) {
      chkValRegal.addEventListener('change', function () {
        valCodeWrap.style.display = this.checked ? 'block' : 'none';
      });
    }

    const chkAlumne = document.getElementById('chk-soc-alumne');
    const alumneCodeWrap = document.getElementById('alumne-code-wrap');
    if (chkAlumne && alumneCodeWrap) {
      chkAlumne.addEventListener('change', function () {
        alumneCodeWrap.style.display = this.checked ? 'block' : 'none';
      });
    }

    // Formulari d'enviament de reserva
    if (bookingForm) {
      bookingForm.addEventListener('submit', handleBookingSubmit);
    }

    // Seleccionar primer dia obert
    selectInitialDate();
    renderCalendar();
  }

  function selectActivity(act) {
    if (!WORKSHOP_CONFIG.capacities[act]) return;
    bookingState.activity = act;

    // Actualitzar botons
    document.querySelectorAll('.booking-act-btn').forEach(b => {
      if (b.getAttribute('data-act') === act) {
        b.classList.add('selected');
      } else {
        b.classList.remove('selected');
      }
    });

    // Actualitzar opcions de persones segons capacitat màxima
    const maxPersons = WORKSHOP_CONFIG.capacities[act];
    const select = document.getElementById('booking-persons');
    if (select) {
      const currentVal = parseInt(select.value, 10) || 1;
      select.innerHTML = '';
      for (let i = 1; i <= maxPersons; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i === 1 ? '1 persona' : i + ' persones';
        if (i === Math.min(currentVal, maxPersons)) {
          opt.selected = true;
        }
        select.appendChild(opt);
      }
      bookingState.numPersons = Math.min(currentVal, maxPersons);
    }

    renderCalendar();
    updateShiftSpots();
  }

  function selectInitialDate() {
    const today = new Date();
    let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Si avui és passat l'horari o dilluns/dimarts, buscar el següent dia laborable
    let attempts = 0;
    while (attempts < 14) {
      const dayOfWeek = d.getDay(); // 0 = diumenge, 1 = dilluns...
      if (!WORKSHOP_CONFIG.closedWeekdays.includes(dayOfWeek)) {
        // dia vàlid
        bookingState.date = formatDate(d);
        bookingState.currentMonth = d.getMonth();
        bookingState.currentYear = d.getFullYear();
        break;
      }
      d.setDate(d.getDate() + 1);
      attempts++;
    }
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function renderCalendar() {
    const grid = document.getElementById('cal-grid-days');
    const titleEl = document.getElementById('cal-month-title');
    if (!grid || !titleEl) return;

    const monthNames = [
      'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
      'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'
    ];
    titleEl.textContent = `${monthNames[bookingState.currentMonth]} ${bookingState.currentYear}`;

    grid.innerHTML = '';

    const firstDayIndex = new Date(bookingState.currentYear, bookingState.currentMonth, 1).getDay();
    // Ajustar dilluns = 0 (per defecte diumenge = 0)
    const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    const totalDays = new Date(bookingState.currentYear, bookingState.currentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Cel·les buides abans del primer dia
    for (let i = 0; i < startOffset; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day empty';
      grid.appendChild(emptyCell);
    }

    // Dies del mes
    for (let day = 1; day <= totalDays; day++) {
      const dateObj = new Date(bookingState.currentYear, bookingState.currentMonth, day);
      const dateStr = formatDate(dateObj);
      const dayOfWeek = dateObj.getDay(); // 0 = dg, 1 = dl, 2 = dt...

      const cell = document.createElement('div');
      cell.className = 'cal-day';
      cell.textContent = day;

      const isPast = dateObj < today;
      const isClosed = WORKSHOP_CONFIG.closedWeekdays.includes(dayOfWeek);

      if (isPast) {
        cell.classList.add('disabled');
      } else if (isClosed) {
        cell.classList.add('closed-day');
        cell.title = 'Tancat per descans setmanal (Dilluns i Dimarts)';
      } else {
        cell.classList.add('available');
        if (bookingState.date === dateStr) {
          cell.classList.add('selected');
        }

        cell.addEventListener('click', function () {
          bookingState.date = dateStr;
          renderCalendar();
          updateShiftSpots();
        });
      }

      grid.appendChild(cell);
    }

    updateSelectedDateDisplay();
  }

  function updateSelectedDateDisplay() {
    const label = document.getElementById('selected-date-label');
    if (!label || !bookingState.date) return;

    const [y, m, d] = bookingState.date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayNames = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
    const monthNames = [
      'gener', 'febrer', 'març', 'abril', 'maig', 'juny',
      'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'
    ];

    const dayName = dayNames[dateObj.getDay()];
    const monthName = monthNames[dateObj.getMonth()];
    label.textContent = `${dayName}, ${d} de ${monthName} de ${y}`;
  }

  async function updateShiftSpots() {
    const spotsMati = document.getElementById('spots-mati');
    const spotsTarda = document.getElementById('spots-tarda');
    const maxCapacity = WORKSHOP_CONFIG.capacities[bookingState.activity] || 4;

    if (!spotsMati || !spotsTarda || !bookingState.date) return;

    // Consultar API en temps real
    try {
      const res = await fetch(`/api/reserves/disponibilitat?data=${bookingState.date}&activitat=${bookingState.activity}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.franges) {
          const fm = data.franges.find(f => f.id === 'mati' || f.nom?.toLowerCase().includes('matí'));
          const ft = data.franges.find(f => f.id === 'tarda' || f.nom?.toLowerCase().includes('tarda'));

          const lliuresMati = fm ? fm.disponibles : maxCapacity;
          const lliuresTarda = ft ? ft.disponibles : maxCapacity;

          spotsMati.textContent = `${lliuresMati} places disponibles`;
          spotsTarda.textContent = `${lliuresTarda} places disponibles`;

          toggleShiftAvailability('shift-mati', lliuresMati >= bookingState.numPersons);
          toggleShiftAvailability('shift-tarda', lliuresTarda >= bookingState.numPersons);
          return;
        }
      }
    } catch (err) {
      // Servidor local o sense xarxa
    }

    // Fallback estàtic
    spotsMati.textContent = `${maxCapacity} places disponibles`;
    spotsTarda.textContent = `${maxCapacity} places disponibles`;
  }

  function toggleShiftAvailability(cardId, isAvailable) {
    const card = document.getElementById(cardId);
    if (!card) return;
    if (isAvailable) {
      card.classList.remove('disabled');
    } else {
      card.classList.add('disabled');
      if (card.classList.contains('selected')) {
        card.classList.remove('selected');
        // Seleccionar l'altre torn si és disponible
        const otherId = cardId === 'shift-mati' ? 'shift-tarda' : 'shift-mati';
        const other = document.getElementById(otherId);
        if (other && !other.classList.contains('disabled')) {
          other.classList.add('selected');
          bookingState.shift = other.getAttribute('data-shift');
        }
      }
    }
  }

  async function handleBookingSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');

    const nom = form.querySelector('#client-nom')?.value.trim();
    const telefon = form.querySelector('#client-tel')?.value.trim();
    const email = form.querySelector('#client-email')?.value.trim();
    const notes = form.querySelector('#client-notes')?.value.trim() || '';
    const isValRegal = form.querySelector('#chk-val-regal')?.checked || false;
    const codiValRegal = form.querySelector('#val-code-input')?.value.trim() || '';
    const isAlumne = form.querySelector('#chk-soc-alumne')?.checked || false;
    const studentId = form.querySelector('#alumne-code-input')?.value.trim() || '';

    if (!nom || !telefon) {
      alert('Si us plau, indica el teu nom complet i telèfon de contacte.');
      return;
    }

    if (!bookingState.date) {
      alert('Si us plau, selecciona una data al calendari.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Tramitant la teva reserva...';
    }

    const payload = {
      activitat_id: bookingState.activity,
      activitat: WORKSHOP_CONFIG.names[bookingState.activity],
      places: bookingState.numPersons,
      data: bookingState.date,
      franja_id: bookingState.shift,
      hora_inici: bookingState.arrivalTime,
      nom: nom,
      telefon: telefon,
      email: email,
      notes: notes,
      val_regal: isValRegal ? 1 : 0,
      codi_val_regal: codiValRegal,
      soc_alumne: isAlumne ? 1 : 0,
      student_id: studentId
    };

    try {
      const response = await fetch('/api/reserves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        showConfirmationModal({
          nom: nom,
          telefon: telefon,
          activitat: WORKSHOP_CONFIG.names[bookingState.activity],
          places: bookingState.numPersons,
          data: bookingState.date,
          torn: bookingState.shift === 'mati' ? 'Matí (10:00 - 13:00)' : 'Tarda (17:00 - 20:00)',
          horaArribada: bookingState.arrivalTime,
          notes: notes,
          valRegal: isValRegal ? (codiValRegal || 'Sí') : null,
          reservaId: result.id || 'CONF-' + Date.now().toString().slice(-6)
        });
        form.reset();
      } else {
        alert(result.error || 'No s ha pogut completar la reserva. Revisa la disponibilitat de places.');
      }
    } catch (err) {
      // Fallback mode offline / enviament via WhatsApp directe
      showConfirmationModal({
        nom: nom,
        telefon: telefon,
        activitat: WORKSHOP_CONFIG.names[bookingState.activity],
        places: bookingState.numPersons,
        data: bookingState.date,
        torn: bookingState.shift === 'mati' ? 'Matí (10:00 - 13:00)' : 'Tarda (17:00 - 20:00)',
        horaArribada: bookingState.arrivalTime,
        notes: notes,
        valRegal: isValRegal ? (codiValRegal || 'Sí') : null,
        reservaId: 'PENDENT-WHATSAPP'
      });
      form.reset();
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirmar Reserva de Plaça';
      }
    }
  }

  function showConfirmationModal(details) {
    const modal = document.getElementById('booking-modal');
    if (!modal) return;

    const summaryEl = document.getElementById('modal-summary-content');
    const waLinkEl = document.getElementById('modal-wa-btn');

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="background: #FBF4F2; border: 1px solid #E8E1DA; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px; line-height: 1.6;">
          <p><strong>Titular:</strong> ${escapeHtml(details.nom)}</p>
          <p><strong>Activitat:</strong> ${escapeHtml(details.activitat)}</p>
          <p><strong>Places:</strong> ${details.places} ${details.places === 1 ? 'persona' : 'persones'}</p>
          <p><strong>Data:</strong> ${escapeHtml(details.data)}</p>
          <p><strong>Torn:</strong> ${escapeHtml(details.torn)} (Arribada: ${details.horaArribada}h)</p>
          ${details.valRegal ? `<p><strong>Val Regal:</strong> ${escapeHtml(details.valRegal)}</p>` : ''}
          <p style="margin-top: 8px; font-size: 12px; color: #787069;">Codi de referència: <code>${escapeHtml(details.reservaId)}</code></p>
        </div>
      `;
    }

    // Enllaç WhatsApp automàtic
    if (waLinkEl) {
      const waText = encodeURIComponent(
        `Hola Roig de Coure! Vull confirmar la meva reserva al taller:\n` +
        `- Activitat: ${details.activitat}\n` +
        `- Data: ${details.data}\n` +
        `- Torn: ${details.torn} (Arribada ${details.horaArribada}h)\n` +
        `- Places: ${details.places}\n` +
        `- Nom: ${details.nom}\n` +
        `- Telèfon: ${details.telefon}` +
        (details.valRegal ? `\n- Val Regal: ${details.valRegal}` : '')
      );
      waLinkEl.href = `https://wa.me/${WORKSHOP_CONFIG.phone}?text=${waText}`;
    }

    modal.classList.add('active');

    // Tancar modal
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => modal.classList.remove('active');
    }
  }

  /* ==========================================================================
     3. VAL REGAL INTERACTIU & GENERACIÓ
     ========================================================================== */
  function initGiftVoucher() {
    const expSelect = document.getElementById('gift-exp-select');
    const toInput = document.getElementById('gift-to-input');
    const fromInput = document.getElementById('gift-from-input');
    const msgInput = document.getElementById('gift-msg-input');

    const previewExp = document.getElementById('preview-gift-exp');
    const previewTo = document.getElementById('preview-gift-to');
    const previewMsg = document.getElementById('preview-gift-msg');
    const previewCode = document.getElementById('preview-gift-code');
    const printBtn = document.getElementById('gift-print-btn');
    const waGiftBtn = document.getElementById('gift-wa-btn');

    function updatePreview() {
      if (previewExp && expSelect) previewExp.textContent = expSelect.options[expSelect.selectedIndex].text;
      if (previewTo && toInput) previewTo.textContent = toInput.value.trim() || 'Persona Afortunada';
      if (previewMsg && msgInput) previewMsg.textContent = msgInput.value.trim() || 'Esperem que gaudeixis d aquesta experiència única al fang!';
    }

    if (expSelect) expSelect.addEventListener('change', updatePreview);
    if (toInput) toInput.addEventListener('input', updatePreview);
    if (msgInput) msgInput.addEventListener('input', updatePreview);

    // Codi únic de cupó
    if (previewCode) {
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      previewCode.textContent = `RDC-${new Date().getFullYear()}-${randSuffix}`;
    }

    if (printBtn) {
      printBtn.addEventListener('click', function () {
        window.print();
      });
    }

    if (waGiftBtn) {
      waGiftBtn.addEventListener('click', function (e) {
        e.preventDefault();
        const exp = expSelect ? expSelect.options[expSelect.selectedIndex].text : 'Experiència de Ceràmica';
        const to = toInput?.value.trim() || 'Un amic/ga';
        const from = fromInput?.value.trim() || '';
        const code = previewCode?.textContent || 'VAL-RDC';

        const text = encodeURIComponent(
          `Hola Roig de Coure! Vull adquirir un Val Regal:\n` +
          `- Experiència: ${exp}\n` +
          `- Per a: ${to}` +
          (from ? `\n- De part de: ${from}` : '') +
          `\n- Codi de val generat: ${code}`
        );
        window.open(`https://wa.me/${WORKSHOP_CONFIG.phone}?text=${text}`, '_blank');
      });
    }

    updatePreview();
  }

  /* ==========================================================================
     4. PREGUNTES FREQÜENTS (FAQ)
     ========================================================================== */
  function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
      const q = item.querySelector('.faq-question');
      if (q) {
        q.addEventListener('click', function () {
          const isOpen = item.classList.contains('open');

          // Opcional: tancar els altres
          faqItems.forEach(other => {
            if (other !== item) other.classList.remove('open');
          });

          if (isOpen) {
            item.classList.remove('open');
          } else {
            item.classList.add('open');
          }
        });
      }
    });
  }

  /* ==========================================================================
     5. FORMULARI DE CONTACTE RÀPID
     ========================================================================== */
  function initContactForm() {
    const form = document.getElementById('contact-quick-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const nom = form.querySelector('#c-nom')?.value.trim();
      const tel = form.querySelector('#c-tel')?.value.trim();
      const msg = form.querySelector('#c-msg')?.value.trim();

      if (!nom || !msg) {
        alert('Si us plau, indica el teu nom i missatge.');
        return;
      }

      const text = encodeURIComponent(
        `Hola Roig de Coure! Consulta des de la web:\n` +
        `- Nom: ${nom}\n` +
        `- Telèfon: ${tel || 'No indicat'}\n` +
        `- Missatge: ${msg}`
      );
      window.open(`https://wa.me/${WORKSHOP_CONFIG.phone}?text=${text}`, '_blank');
      form.reset();
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
