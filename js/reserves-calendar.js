/**
 * reserves-calendar.js
 * Component visual de calendari mensual i selector de 2 camins ("Tria per Data" i "Escollir per Activitat")
 * per a Roig de Coure.
 * 
 * Regles oficials d'aforament:
 * - Aforament màxim del taller per franja: 12 persones simultànies en total entre totes les activitats.
 * - Activitats:
 *    * Torn: màxim 4 torns físics simultanis.
 *    * Modelatge: fins a 8 places (limitat pel global de la franja).
 *    * Pintar ceràmica: fins a 12 places (limitat pel global de la franja).
 * - Franges de 90 min:
 *    * F1: 10:00 - 11:30
 *    * F2: 11:30 - 13:00
 *    * F3: 17:00 - 18:30
 *    * F4: 18:30 - 20:00
 * - Obertura: Dimecres a Diumenge (Dilluns i Dimarts tancat per descans setmanal).
 */

class ReservesCalendar {
  constructor(options = {}) {
    this.containerId = options.containerId;
    this.container = typeof options.container === 'object' ? options.container : document.getElementById(this.containerId);
    this.isAdmin = !!options.isAdmin;
    this.currentStudent = options.currentStudent || null;
    this.onBookingSuccess = options.onBookingSuccess || null;
    this.allStudents = options.allStudents || [];

    // Estat intern
    this.activePath = options.initialPath || 'date'; // 'date' (Camí 1) o 'activity' (Camí 2)
    this.selectedActivityId = options.initialActivity || 'torn';
    
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth() + 1; // 1-12
    this.selectedDate = this._getInitialOpenDate();

    this.monthData = null;
    this.dayData = null;
    this.loadingMonth = false;
    this.loadingDay = false;

    this.MONTH_NAMES = [
      'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
      'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'
    ];

    this.ACTIVITATS = [
      { id: 'torn', nom: 'Torn de terrissaire', icon: '🏺', color: '#C25E3A', capacitatMax: 4, desc: 'Màx. 4 torns' },
      { id: 'modelatge', nom: 'Modelatge i escultura', icon: '🗿', color: '#5E7E6F', capacitatMax: 8, desc: 'Fins a 8 places' },
      { id: 'pintar', nom: 'Pintar ceràmica', icon: '🎨', color: '#F59E0B', capacitatMax: 12, desc: 'Fins a 12 places' }
    ];

    this.modalEl = null;
  }

  setStudent(student) {
    this.currentStudent = student;
  }

  setAllStudents(students) {
    this.allStudents = students || [];
  }

  /**
   * Retorna la propera data vàlida d'obertura (Dimecres a Diumenge)
   */
  _getInitialOpenDate() {
    const d = new Date();
    const day = d.getDay(); // 0: Dg, 1: Dl, 2: Dt, 3: Dc...
    if (day === 1) { // Dilluns -> Dimecres (+2)
      d.setDate(d.getDate() + 2);
    } else if (day === 2) { // Dimarts -> Dimecres (+1)
      d.setDate(d.getDate() + 1);
    }
    return this._formatDateISO(d);
  }

  _formatDateISO(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _formatCatalanDate(dateStr) {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      const diesSetmana = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
      const diaNom = diesSetmana[d.getDay()];
      const diaNum = d.getDate();
      const mesNom = this.MONTH_NAMES[d.getMonth()].toLowerCase();
      const any = d.getFullYear();
      return `${diaNom}, ${diaNum} de ${mesNom} de ${any}`;
    } catch (e) {
      return dateStr;
    }
  }

  async init() {
    if (!this.container) {
      console.warn('ReservesCalendar: no container found with ID', this.containerId);
      return;
    }
    await this.refresh();
  }

  async refresh() {
    await this.loadMonthData(this.currentYear, this.currentMonth);
    await this.loadDayData(this.selectedDate);
    this.render();
  }

  async loadMonthData(year, month) {
    this.loadingMonth = true;
    try {
      if (typeof Store !== 'undefined' && Store.getDisponibilitatMes) {
        this.monthData = await Store.getDisponibilitatMes(year, month);
      }
    } catch (err) {
      console.error('Error carregant mes de reserves:', err);
    } finally {
      this.loadingMonth = false;
    }
  }

  async loadDayData(dateStr) {
    this.loadingDay = true;
    try {
      if (typeof Store !== 'undefined' && Store.getDisponibilitat) {
        this.dayData = await Store.getDisponibilitat(dateStr);
        if (this.dayData && this.dayData.activitats && Array.isArray(this.dayData.activitats) && this.dayData.activitats.length > 0) {
          this.ACTIVITATS = this.dayData.activitats.map(a => ({
            id: a.id,
            nom: a.nom,
            icon: a.icon || (a.id === 'torn' ? '🏺' : a.id === 'modelatge' ? '🗿' : '🎨'),
            color: a.color || (a.id === 'torn' ? '#C25E3A' : a.id === 'modelatge' ? '#5E7E6F' : '#F59E0B'),
            capacitatMax: a.capacitatMax,
            desc: a.descripcio || (a.id === 'torn' ? `Màx. ${a.capacitatMax} torns` : `Fins a ${a.capacitatMax} places`)
          }));
        }
      }
    } catch (err) {
      console.error('Error carregant dia de reserves:', err);
    } finally {
      this.loadingDay = false;
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="reserves-calendar-widget">
        <!-- 1. Tria de Camí (2 Camins) -->
        ${this._renderPathsToggleHtml()}

        <!-- 2. Si Camí 2: Selector d'Activitats i properes sessions -->
        ${this.activePath === 'activity' ? this._renderActivitySelectorHtml() : ''}
        ${this.activePath === 'activity' ? this._renderUpcomingSessionsHtml() : ''}

        <!-- 3. Calendari Mensual Visual -->
        ${this._renderCalendarCardHtml()}

        <!-- 4. Detall de Franges del Dia Seleccionat -->
        ${this._renderDayDetailHtml()}
      </div>
    `;

    this._attachEventListeners();
  }

  _renderPathsToggleHtml() {
    return `
      <div class="res-paths-nav">
        <button type="button" class="res-path-btn ${this.activePath === 'date' ? 'active' : ''}" data-path="date">
          <span class="path-icon">📅</span>
          <div class="path-text">
            <strong>Camí 1: Triar per Data</strong>
            <small>Consulta el calendari i tria l'activitat per al dia que vulguis</small>
          </div>
        </button>

        <button type="button" class="res-path-btn ${this.activePath === 'activity' ? 'active' : ''}" data-path="activity">
          <span class="path-icon">🏺</span>
          <div class="path-text">
            <strong>Camí 2: Escollir per Activitat</strong>
            <small>Tria Torn, Modelatge o Pintar ceràmica i troba places ràpidament</small>
          </div>
        </button>
      </div>
    `;
  }

  _renderActivitySelectorHtml() {
    return `
      <div style="margin-bottom: 8px;">
        <label style="font-size: 13px; font-weight: 800; color: var(--color-dark); display: block; margin-bottom: 8px;">
          Tria l'activitat que vols fer:
        </label>
        <div class="res-activities-grid">
          ${this.ACTIVITATS.map(act => {
            const isSelected = this.selectedActivityId === act.id;
            return `
              <div class="res-activity-card ${isSelected ? 'active' : ''}" data-act-id="${act.id}">
                <div class="act-icon">${act.icon}</div>
                <div class="act-info">
                  <div class="act-name">${act.nom}</div>
                  <div class="act-cap">${act.desc}</div>
                </div>
                <span class="act-badge">${act.capacitatMax}p</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  _renderUpcomingSessionsHtml() {
    const act = this.ACTIVITATS.find(a => a.id === this.selectedActivityId) || this.ACTIVITATS[0];
    const upcomingChips = [];

    if (this.monthData && this.monthData.dies) {
      const todayISO = this._formatDateISO(new Date());
      const sortedKeys = Object.keys(this.monthData.dies)
        .filter(k => k >= todayISO && !this.monthData.dies[k].tancat)
        .sort();

      for (const k of sortedKeys) {
        const dInfo = this.monthData.dies[k];
        if (dInfo.activitatsAmbPlaces && dInfo.activitatsAmbPlaces.includes(act.id)) {
          const parts = k.split('-');
          const dObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          const diesCurts = ['Dg', 'Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds'];
          const diaText = `${diesCurts[dObj.getDay()]} ${dObj.getDate()} ${this.MONTH_NAMES[dObj.getMonth()].slice(0, 3)}`;
          upcomingChips.push({
            date: k,
            text: diaText,
            places: dInfo.placesLliures
          });
          if (upcomingChips.length >= 6) break;
        }
      }
    }

    if (upcomingChips.length === 0) return '';

    return `
      <div class="res-upcoming-sessions-box">
        <h4>
          <span>✨</span>
          <span>Properes dates amb places disponibles per a ${act.icon} ${act.nom}:</span>
        </h4>
        <div class="res-upcoming-list">
          ${upcomingChips.map(c => `
            <button type="button" class="res-upcoming-chip ${c.date === this.selectedDate ? 'selected' : ''}" data-date="${c.date}">
              <span>📅 ${c.text}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  _renderCalendarCardHtml() {
    const year = this.currentYear;
    const month = this.currentMonth;
    const monthTitle = `${this.MONTH_NAMES[month - 1]} ${year}`;

    // Primer dia del mes (0 = Dg, 1 = Dl... convertim a 0 = Dl, 6 = Dg)
    const firstDay = new Date(year, month - 1, 1).getDay();
    const startCol = firstDay === 0 ? 6 : firstDay - 1; // 0 per a Dilluns
    const daysInMonth = new Date(year, month, 0).getDate();

    const todayISO = this._formatDateISO(new Date());

    let daysHtml = '';
    // Cel·les buides d'offset
    for (let i = 0; i < startCol; i++) {
      daysHtml += `<div class="res-cal-day empty"></div>`;
    }

    // Cel·les de dies
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayObj = new Date(year, month - 1, d);
      const dayOfWeek = dayObj.getDay(); // 0 = Dg, 1 = Dl, 2 = Dt...

      const isToday = dateStr === todayISO;
      const isSelected = dateStr === this.selectedDate;

      // Comprovar si tancat per descans setmanal (Dilluns = 1, Dimarts = 2)
      const isRest = dayOfWeek === 1 || dayOfWeek === 2;

      let dInfo = this.monthData && this.monthData.dies ? this.monthData.dies[dateStr] : null;
      const isClosed = isRest || (dInfo && dInfo.tancat);
      const isHoliday = !isRest && dInfo && dInfo.tancat;

      let cellClasses = ['res-cal-day'];
      if (isToday) cellClasses.push('is-today');
      if (isSelected) cellClasses.push('selected');

      let badgeHtml = '';

      if (isRest) {
        cellClasses.push('closed-rest');
        badgeHtml = `<span class="day-badge badge-tancat" title="Descans setmanal">🔒 Tancat</span>`;
      } else if (isHoliday) {
        cellClasses.push('closed-holiday');
        badgeHtml = `<span class="day-badge badge-complet" title="${dInfo && dInfo.motiu ? dInfo.motiu : 'Festiu'}">🎉 Festiu</span>`;
      } else {
        cellClasses.push('open-day');
        if (this.activePath === 'activity') {
          // Camí 2: Highlight segons si té plaça per a l'activitat seleccionada
          const hasActSpot = dInfo && dInfo.activitatsAmbPlaces && dInfo.activitatsAmbPlaces.includes(this.selectedActivityId);
          if (hasActSpot) {
            badgeHtml = `<span class="day-badge badge-lliure">🟢 Places</span>`;
          } else {
            badgeHtml = `<span class="day-badge badge-complet">🔴 Esgotat</span>`;
          }
        } else {
          // Camí 1: Disponibilitat global
          if (!dInfo) {
            badgeHtml = `<span class="day-badge badge-lliure">🟢 Lliure</span>`;
          } else if (dInfo.estat === 'complet') {
            badgeHtml = `<span class="day-badge badge-complet">🔴 Ple</span>`;
          } else if (dInfo.estat === 'ultimes_places') {
            badgeHtml = `<span class="day-badge badge-ultimes">🟠 ${dInfo.placesLliures} ll.</span>`;
          } else {
            badgeHtml = `<span class="day-badge badge-lliure">🟢 ${dInfo.placesLliures} ll.</span>`;
          }
        }
      }

      daysHtml += `
        <div class="${cellClasses.join(' ')}" data-date="${dateStr}" ${isRest ? 'title="Tancat per descans setmanal (Dilluns i Dimarts). Obrim de Dimecres a Diumenge."' : ''}>
          <div class="day-header">
            <span class="day-num">${d}</span>
            ${isToday ? '<span style="font-size:9px; font-weight:800; color:var(--color-primary);">AVUI</span>' : ''}
          </div>
          <div>
            ${badgeHtml}
          </div>
        </div>
      `;
    }

    return `
      <div class="res-calendar-card">
        <div class="res-calendar-header">
          <div class="res-calendar-title">
            <span>📅</span>
            <span>${monthTitle}</span>
          </div>
          <div class="res-calendar-nav-btns">
            <button type="button" class="res-calendar-nav-btn" id="btn-res-mes-ant">‹ Mes Anterior</button>
            <button type="button" class="res-calendar-nav-btn" id="btn-res-mes-avui">Avui</button>
            <button type="button" class="res-calendar-nav-btn" id="btn-res-mes-seg">Mes Següent ›</button>
          </div>
        </div>

        <div class="res-calendar-weekdays">
          <div class="res-calendar-weekday closed">Dl (Tancat)</div>
          <div class="res-calendar-weekday closed">Dt (Tancat)</div>
          <div class="res-calendar-weekday">Dc (Obert)</div>
          <div class="res-calendar-weekday">Dj (Obert)</div>
          <div class="res-calendar-weekday">Dv (Obert)</div>
          <div class="res-calendar-weekday">Ds (Obert)</div>
          <div class="res-calendar-weekday">Dg (Obert)</div>
        </div>

        <div class="res-calendar-grid">
          ${daysHtml}
        </div>
      </div>
    `;
  }

  _renderDayDetailHtml() {
    const dateStr = this.selectedDate;
    const formattedDate = this._formatCatalanDate(dateStr);
    const day = this.dayData;

    if (this.loadingDay) {
      return `
        <div class="res-day-detail-card">
          <div style="text-align:center; padding: 30px; color: var(--color-muted);">
            ⏳ Carregant disponibilitat per al ${formattedDate}...
          </div>
        </div>
      `;
    }

    if (!day) {
      return `
        <div class="res-day-detail-card">
          <div style="text-align:center; padding: 30px; color: var(--color-muted);">
            Selecciona una data al calendari per veure les franges i l'aforament.
          </div>
        </div>
      `;
    }

    if (day.tancat) {
      return `
        <div class="res-day-detail-card">
          <div class="res-day-detail-header">
            <div class="res-day-detail-date">
              <span>📅</span> <span>${formattedDate}</span>
            </div>
            <span class="res-day-global-rule" style="background:#FFEBEE; color:#C62828;">Taller Tancat</span>
          </div>
          <div style="padding: 24px; text-align: center; color: var(--color-muted); background: #FAF9F8; border-radius: var(--radius-md);">
            <div style="font-size: 32px; margin-bottom: 8px;">🔒</div>
            <h4 style="font-size: 15px; font-weight: 700; color: var(--color-dark);">${day.motiu || 'El taller roman tancat aquest dia.'}</h4>
            <p style="font-size: 13px; margin-top: 4px;">Horari habitual: obert de <strong>Dimecres a Diumenge</strong> de 10:00 a 13:00 i de 17:00 a 20:00.</p>
          </div>
        </div>
      `;
    }

    const franges = day.franges || [];
    const maxCapFranja = day.aforamentMaxim || 12;

    return `
      <div class="res-day-detail-card">
        <div class="res-day-detail-header">
          <div>
            <div class="res-day-detail-date">
              <span>📅</span> <span>${formattedDate}</span>
            </div>
            <div style="font-size: 12px; color: var(--color-muted); margin-top: 2px;">
              Ocupació total del dia: <strong>${day.totalOcupadesDia} / ${day.totalPlacesDia} places</strong>
            </div>
          </div>
          <div class="res-day-global-rule">
            👥 Aforament màxim del taller: <strong>12 places simultànies</strong> per torn
          </div>
        </div>

        <div class="res-slots-grid">
          ${franges.map(f => this._renderSlotCardHtml(f, maxCapFranja)).join('')}
        </div>
      </div>
    `;
  }

  _renderSlotCardHtml(f, maxCapFranja) {
    const isFull = f.placesLliures <= 0;
    const ocupades = f.placesOcupades || 0;
    const lliures = f.placesLliures || 0;
    const perc = Math.min(100, Math.round((ocupades / maxCapFranja) * 100));

    let badgeClass = 'open';
    let badgeText = `🟢 ${lliures} places lliures`;
    let fillClass = '';

    if (isFull) {
      badgeClass = 'full';
      badgeText = `🔴 COMPLET (${ocupades}/${maxCapFranja})`;
      fillClass = 'full';
    } else if (lliures <= 3) {
      badgeClass = 'warning';
      badgeText = `🟠 ÚLTIMES ${lliures} PLACES!`;
      fillClass = 'warning';
    }

    // Activitats dins d'aquesta franja
    const actsHtml = (f.activitats || []).map(act => {
      const isActFull = isFull || act.placesDisponibles <= 0;
      const isHighlighted = this.activePath === 'activity' && this.selectedActivityId === act.id;

      let bookBtn = '';
      if (this.isAdmin) {
        bookBtn = `
          <button type="button" class="btn-book-act btn-open-booking-modal" data-slot-id="${f.id}" data-act-id="${act.id}" data-spots="${act.placesDisponibles}" ${isActFull ? 'disabled' : ''}>
            ${isActFull ? 'Esgotat' : '+ Reservar'}
          </button>
        `;
      } else {
        bookBtn = `
          <button type="button" class="btn-book-act btn-open-booking-modal" data-slot-id="${f.id}" data-act-id="${act.id}" data-spots="${act.placesDisponibles}" ${isActFull ? 'disabled' : ''}>
            ${isActFull ? 'Esgotat' : 'Reservar'}
          </button>
        `;
      }

      return `
        <div class="res-slot-act-row ${isHighlighted ? 'is-highlighted' : ''} ${isActFull ? 'is-full' : ''}">
          <div class="res-slot-act-name">
            <span>${act.icon}</span>
            <span>${act.nom}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="res-slot-act-spots">
              ${act.placesDisponibles} disp. (màx ${act.capacitatMax})
            </span>
            ${bookBtn}
          </div>
        </div>
      `;
    }).join('');

    // Llistat d'alumnes inscrits (Només visible en mode Admin)
    let adminStudentsHtml = '';
    if (this.isAdmin) {
      const resList = f.reserves || [];
      adminStudentsHtml = `
        <div class="res-slot-students-list">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:700; color:var(--color-muted);">
            <span>ALUMNES INSCRITS (${resList.length})</span>
            <button type="button" class="btn btn-outline btn-sm btn-quick-add-admin" data-slot-id="${f.id}" style="padding:1px 6px; font-size:10px; font-weight:700;">
              ➕ Reserva Manual
            </button>
          </div>
          ${resList.length === 0 ? '<p style="font-size:11px; color:var(--color-muted); margin:4px 0;">Cap alumne inscrit en aquesta franja.</p>' : ''}
          ${resList.map(r => `
            <div class="res-student-item">
              <div class="res-student-info">
                <strong>${r.student_id || ''}</strong>
                <span>${r.student_nom || r.nom || ''}</span>
                <span style="color:var(--color-muted); font-size:11px;">(${r.activitat || 'Torn'}, ${r.places || 1}p)</span>
              </div>
              <div class="res-student-actions">
                ${r.telefon ? `
                  <a href="https://wa.me/34${String(r.telefon).replace(/[^0-9]/g, '')}" target="_blank" class="btn-student-whatsapp" title="Obrir WhatsApp">💬</a>
                ` : ''}
                <button type="button" class="btn-admin-cancel-res" data-res-id="${r.id}" title="Cancel·lar i alliberar plaça">
                  ✕
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    return `
      <div class="res-slot-box ${isFull ? 'is-full' : 'is-open'}">
        <div>
          <div class="res-slot-header">
            <div>
              <div class="res-slot-time">${f.nom}</div>
              <div class="res-slot-hours">⏰ ${f.inici} - ${f.fi} (${f.hores}h)</div>
            </div>
            <span class="res-slot-cap-badge ${badgeClass}">
              ${badgeText}
            </span>
          </div>

          <!-- Barra de progrés d'aforament franja -->
          <div class="res-slot-progress-wrap">
            <div class="res-slot-progress-bar">
              <div class="res-slot-progress-fill ${fillClass}" style="width: ${perc}%;"></div>
            </div>
            <div class="res-slot-progress-label">
              <span>Total taller: ${ocupades} / ${maxCapFranja} places</span>
              <span>${perc}%</span>
            </div>
          </div>

          <!-- Desglossament per activitats -->
          <div class="res-slot-acts-list">
            ${actsHtml}
          </div>
        </div>

        ${adminStudentsHtml}
      </div>
    `;
  }

  _attachEventListeners() {
    if (!this.container) return;

    // Toggle de Camins (Data vs Activitat)
    this.container.querySelectorAll('.res-path-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.path;
        if (path && path !== this.activePath) {
          this.activePath = path;
          this.render();
        }
      });
    });

    // Selector d'Activitats (Camí 2)
    this.container.querySelectorAll('.res-activity-card').forEach(card => {
      card.addEventListener('click', () => {
        const actId = card.dataset.actId;
        if (actId) {
          this.selectedActivityId = actId;
          this.render();
        }
      });
    });

    // Propers dies xips (Camí 2)
    this.container.querySelectorAll('.res-upcoming-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const date = chip.dataset.date;
        if (date) {
          this.selectedDate = date;
          await this.loadDayData(date);
          this.render();
        }
      });
    });

    // Navegació de mesos
    const btnMesAnt = this.container.querySelector('#btn-res-mes-ant');
    if (btnMesAnt) {
      btnMesAnt.addEventListener('click', async () => {
        let y = this.currentYear;
        let m = this.currentMonth - 1;
        if (m < 1) { m = 12; y--; }
        this.currentYear = y;
        this.currentMonth = m;
        await this.loadMonthData(y, m);
        this.render();
      });
    }

    const btnMesSeg = this.container.querySelector('#btn-res-mes-seg');
    if (btnMesSeg) {
      btnMesSeg.addEventListener('click', async () => {
        let y = this.currentYear;
        let m = this.currentMonth + 1;
        if (m > 12) { m = 1; y++; }
        this.currentYear = y;
        this.currentMonth = m;
        await this.loadMonthData(y, m);
        this.render();
      });
    }

    const btnMesAvui = this.container.querySelector('#btn-res-mes-avui');
    if (btnMesAvui) {
      btnMesAvui.addEventListener('click', async () => {
        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth() + 1;
        this.selectedDate = this._getInitialOpenDate();
        await this.loadMonthData(this.currentYear, this.currentMonth);
        await this.loadDayData(this.selectedDate);
        this.render();
      });
    }

    // Clic sobre dia del calendari
    this.container.querySelectorAll('.res-cal-day.open-day').forEach(cell => {
      cell.addEventListener('click', async () => {
        const date = cell.dataset.date;
        if (date && date !== this.selectedDate) {
          this.selectedDate = date;
          await this.loadDayData(date);
          this.render();
        }
      });
    });

    // Botons per obrir modal de reserva
    this.container.querySelectorAll('.btn-open-booking-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slotId = btn.dataset.slotId;
        const actId = btn.dataset.actId;
        const spots = parseInt(btn.dataset.spots, 10) || 1;
        this.openBookingModal({ slotId, actId, maxSpots: spots });
      });
    });

    // Mode admin: botó reserva manual ràpida
    this.container.querySelectorAll('.btn-quick-add-admin').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slotId = btn.dataset.slotId;
        this.openBookingModal({ slotId, actId: this.selectedActivityId || 'torn', maxSpots: 12, isManualAdmin: true });
      });
    });

    // Mode admin: cancel·lar reserva
    this.container.querySelectorAll('.btn-admin-cancel-res').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const resId = btn.dataset.resId;
        if (!resId) return;
        if (confirm('Vols cancel·lar aquesta reserva i alliberar la plaça?')) {
          try {
            await Store.cancelarReserva(resId);
            if (typeof showToast === 'function') showToast('Reserva cancel·lada correctament', 'info');
            await this.refresh();
          } catch (err) {
            alert('Error cancel·lant reserva: ' + err.message);
          }
        }
      });
    });
  }

  /**
   * Obre el Modal / Finestra de confirmació de reserva
   */
  openBookingModal(params) {
    const { slotId, actId, maxSpots = 1 } = params;
    const day = this.dayData;
    if (!day) return;

    const franja = (day.franges || []).find(f => f.id === slotId) || { id: slotId, nom: slotId, inici: '10:00', fi: '11:30', hores: 1.5 };
    const act = this.ACTIVITATS.find(a => a.id === actId) || this.ACTIVITATS[0];

    // Eliminar modal existent si n'hi ha
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop active';
    modalBackdrop.style.zIndex = '3000';

    let studentFieldsHtml = '';
    if (this.isAdmin) {
      studentFieldsHtml = `
        <div class="form-group">
          <label style="font-size:12px; font-weight:700;">Alumne / Client *</label>
          <select id="modal-booking-student-select" class="form-control" style="font-size:13px;" required>
            <option value="">-- Selecciona de la llista o introdueix-ne un de nou --</option>
            ${this.allStudents.map(s => `
              <option value="${s.id}" data-nom="${s.nom} ${s.cognoms || ''}" data-tel="${s.telefon || ''}">
                ${s.id} - ${s.nom} ${s.cognoms || ''} ${s.telefon ? `(${s.telefon})` : ''}
              </option>
            `).join('')}
            <option value="NOU_CLIENT">➕ Nou Client (Introduir manualment)</option>
          </select>
        </div>

        <div id="modal-booking-manual-inputs" style="display:none; background:#F8F9FA; border:1px dashed var(--color-border); border-radius:var(--radius-sm); padding:10px; margin-bottom:12px;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <div>
              <label style="font-size:11px; font-weight:700;">Nom complet</label>
              <input type="text" id="modal-booking-manual-name" class="form-control" placeholder="ex. Anna Serra" style="font-size:12px; padding:6px 10px;">
            </div>
            <div>
              <label style="font-size:11px; font-weight:700;">Telèfon / WhatsApp</label>
              <input type="tel" id="modal-booking-manual-phone" class="form-control" placeholder="600 000 000" style="font-size:12px; padding:6px 10px;">
            </div>
          </div>
        </div>
      `;
    }

    modalBackdrop.innerHTML = `
      <div class="modal-dialog res-booking-dialog">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:32px;">${act.icon}</span>
            <div>
              <h3 style="margin:0; font-size:17px; font-weight:800; color:var(--color-dark);">Confirmar Reserva</h3>
              <p style="margin:0; font-size:12px; color:var(--color-muted);">${act.nom}</p>
            </div>
          </div>
          <button type="button" class="modal-close" id="btn-modal-booking-close" style="font-size:24px; line-height:1; cursor:pointer; border:none; background:none;">&times;</button>
        </div>

        <!-- Targeta de resum de data i torn -->
        <div style="background:#FFF9F6; border:1.5px solid var(--color-border); border-radius:var(--radius-md); padding:12px 16px; margin-bottom:18px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
            <span style="color:var(--color-muted);">Data:</span>
            <strong style="color:var(--color-dark);">${this._formatCatalanDate(this.selectedDate)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
            <span style="color:var(--color-muted);">Franja horària:</span>
            <strong style="color:var(--color-dark);">${franja.nom} (${franja.inici} - ${franja.fi})</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span style="color:var(--color-muted);">Durada de la sessió:</span>
            <strong style="color:var(--color-primary-dark);">${franja.hores} hores</strong>
          </div>
        </div>

        <form id="form-confirm-booking">
          ${studentFieldsHtml}

          <!-- Selector de Persones (Pax) -->
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="font-size:12px; font-weight:700; margin:0;">Nombre de persones</label>
              <span style="font-size:11px; color:var(--color-muted);">(Màx. ${maxSpots} disponibles)</span>
            </div>
            <div class="res-pax-stepper">
              <button type="button" class="res-pax-btn" id="btn-pax-minus" disabled>-</button>
              <input type="number" id="input-booking-pax" class="res-pax-input" min="1" max="${maxSpots}" value="1" readonly>
              <button type="button" class="res-pax-btn" id="btn-pax-plus" ${maxSpots <= 1 ? 'disabled' : ''}>+</button>
            </div>
          </div>

          <!-- Observacions -->
          <div class="form-group">
            <label style="font-size:12px; font-weight:700;">Observacions (opcional)</label>
            <input type="text" id="input-booking-notes" class="form-control" placeholder="ex. primera vegada, necessito esmaltat..." style="font-size:13px;">
          </div>

          <!-- Botó d'acció -->
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
            <button type="button" class="btn btn-outline btn-sm" id="btn-modal-booking-cancel">Cancel·lar</button>
            <button type="submit" class="btn btn-primary btn-sm" id="btn-modal-booking-submit" style="background:#2E7D32; border-color:#2E7D32; font-weight:700;">
              Confirmar Reserva
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalBackdrop);
    this.modalEl = modalBackdrop;

    // Controls de Pax
    const btnMinus = modalBackdrop.querySelector('#btn-pax-minus');
    const btnPlus = modalBackdrop.querySelector('#btn-pax-plus');
    const inputPax = modalBackdrop.querySelector('#input-booking-pax');

    let currentPax = 1;
    btnMinus.addEventListener('click', () => {
      if (currentPax > 1) {
        currentPax--;
        inputPax.value = currentPax;
        btnPlus.disabled = false;
        if (currentPax === 1) btnMinus.disabled = true;
      }
    });
    btnPlus.addEventListener('click', () => {
      if (currentPax < maxSpots) {
        currentPax++;
        inputPax.value = currentPax;
        btnMinus.disabled = false;
        if (currentPax >= maxSpots) btnPlus.disabled = true;
      }
    });

    // Selector d'alumne en mode admin
    const studentSelect = modalBackdrop.querySelector('#modal-booking-student-select');
    const manualInputs = modalBackdrop.querySelector('#modal-booking-manual-inputs');
    if (studentSelect && manualInputs) {
      studentSelect.addEventListener('change', () => {
        if (studentSelect.value === 'NOU_CLIENT') {
          manualInputs.style.display = 'block';
        } else {
          manualInputs.style.display = 'none';
        }
      });
    }

    // Tancar modal
    const closeModal = () => {
      if (this.modalEl) {
        this.modalEl.remove();
        this.modalEl = null;
      }
    };
    modalBackdrop.querySelector('#btn-modal-booking-close').addEventListener('click', closeModal);
    modalBackdrop.querySelector('#btn-modal-booking-cancel').addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    // Submit del formulari de reserva
    const form = modalBackdrop.querySelector('#form-confirm-booking');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = modalBackdrop.querySelector('#btn-modal-booking-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Reservant...';

      let studentId = '';
      let studentNom = '';
      let studentTel = '';

      if (this.isAdmin) {
        const val = studentSelect ? studentSelect.value : '';
        if (!val) {
          alert('Cal seleccionar un alumne o triar nou client.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirmar Reserva';
          return;
        }
        if (val === 'NOU_CLIENT') {
          const mName = modalBackdrop.querySelector('#modal-booking-manual-name')?.value?.trim();
          const mPhone = modalBackdrop.querySelector('#modal-booking-manual-phone')?.value?.trim();
          if (!mName) {
            alert('Cal introduir el nom complet del client.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Confirmar Reserva';
            return;
          }
          studentId = `CLI-${Date.now().toString().slice(-4)}`;
          studentNom = mName;
          studentTel = mPhone || '';
        } else {
          studentId = val;
          const opt = studentSelect.options[studentSelect.selectedIndex];
          studentNom = opt.dataset.nom || val;
          studentTel = opt.dataset.tel || '';
        }
      } else {
        // Mode alumne
        if (this.currentStudent && this.currentStudent.alumne) {
          studentId = this.currentStudent.alumne.id;
          studentNom = `${this.currentStudent.alumne.nom} ${this.currentStudent.alumne.cognoms || ''}`.trim();
          studentTel = this.currentStudent.alumne.telefon || '';
        } else {
          studentId = 'ALUMNE';
          studentNom = 'Alumne Roig de Coure';
        }
      }

      const notes = modalBackdrop.querySelector('#input-booking-notes')?.value?.trim() || '';

      // Demanar permís de notificació si està en 'default' durant el gest de fer clic a Confirmar
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch (e) {}
      }

      try {
        const res = await Store.crearReserva({
          student_id: studentId,
          student_nom: studentNom,
          telefon: studentTel,
          data: this.selectedDate,
          franja_id: franja.id,
          franja: franja.id,
          activitat: act.nom,
          activitat_id: act.id,
          places: currentPax,
          hora_inici: franja.inici,
          hora_fi: franja.fi,
          hores: parseFloat(franja.hores) || 1.5,
          notes: notes
        });

        if (res.ok) {
          closeModal();
          const reservaObj = res.reserva || res;

          // 1. Enviar Notificació Push al dispositiu
          ReservesCalendar.sendBookingPush(reservaObj);

          // 2. So de confirmació
          if (typeof SoundEngine !== 'undefined' && SoundEngine.playSuccess) {
            SoundEngine.playSuccess();
          } else if (typeof Sound !== 'undefined' && Sound.playSuccess) {
            Sound.playSuccess();
          }

          // 3. Mostrar modal d'èxit amb coordinació de calendaris (Google Calendar / .ics)
          this._showBookingSuccessModal(reservaObj);

          await this.refresh();
          if (typeof this.onBookingSuccess === 'function') {
            this.onBookingSuccess(reservaObj);
          }
        } else {
          alert(res.error || 'No s\'ha pogut completar la reserva');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirmar Reserva';
        }
      } catch (err) {
        alert('Error en crear reserva: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirmar Reserva';
      }
    });
  }

  _showBookingSuccessModal(r) {
    if (!r) return;
    const oldModal = document.getElementById('modal-reserva-success-backdrop');
    if (oldModal) oldModal.remove();

    let dataFormatada = r.data || '';
    try {
      const p = r.data.split('-');
      const dObj = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      dataFormatada = dObj.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      dataFormatada = dataFormatada.charAt(0).toUpperCase() + dataFormatada.slice(1);
    } catch (e) {}

    const startIso = (r.data || '').replace(/-/g, '') + 'T' + (r.hora_inici || '10:00').replace(/:/g, '') + '00';
    const endIso = (r.data || '').replace(/-/g, '') + 'T' + (r.hora_fi || '11:30').replace(/:/g, '') + '00';
    const calTitle = encodeURIComponent(`🏺 ${r.activitat || 'Ceràmica'} - Taller Roig de Coure`);
    const calDesc = encodeURIComponent(`Reserva al Taller de Ceràmica Roig de Coure\nAlumne: ${r.student_nom}\nActivitat: ${r.activitat}\nPlaces: ${r.places || 1}\nHorari: ${r.hora_inici} - ${r.hora_fi}\nID: ${r.id}`);
    const calLoc = encodeURIComponent('Taller de Ceràmica Roig de Coure');
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&dates=${startIso}/${endIso}&details=${calDesc}&location=${calLoc}`;

    const hasPush = ('Notification' in window && Notification.permission === 'granted');

    const backdrop = document.createElement('div');
    backdrop.id = 'modal-reserva-success-backdrop';
    backdrop.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.65); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px; backdrop-filter: blur(4px);
    `;

    backdrop.innerHTML = `
      <div style="background: var(--color-surface, #FFFFFF); border-radius: 20px; max-width: 480px; width: 100%; padding: 26px 22px; box-shadow: 0 20px 40px rgba(0,0,0,0.25); text-align: center; border: 1px solid var(--color-border, #E0D6CE); position: relative;">
        <div style="font-size: 48px; line-height: 1; margin-bottom: 10px;">🎉</div>
        <h3 style="font-size: 21px; font-weight: 800; color: var(--color-dark, #2C2523); margin: 0 0 6px;">Reserva Confirmada!</h3>
        <p style="font-size: 13px; color: var(--color-muted, #766B65); margin: 0 0 16px;">La teva plaça ha quedat degudament reservada al taller.</p>

        <!-- Targeta resum -->
        <div style="background: var(--color-bg, #F9F6F0); border-radius: 14px; padding: 14px 16px; text-align: left; margin-bottom: 16px; border: 1px solid #E8DFD8;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px dashed #DDD2C8; padding-bottom: 8px;">
            <span style="font-size: 14px; font-weight: 700; color: var(--color-primary, #C25E3A);">🏺 ${r.activitat || 'Taller'}</span>
            <span style="background: #E8F5E9; color: #2E7D32; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 99px;">${r.places || 1} ${(r.places || 1) === 1 ? 'plaça' : 'places'}</span>
          </div>
          <div style="font-size: 13px; color: #443B38; line-height: 1.6;">
            <div>📅 <strong>${dataFormatada}</strong></div>
            <div>⏰ <strong>${r.hora_inici} - ${r.hora_fi}</strong> (${r.hores || 1.5}h)</div>
            <div>👤 Alumne: <strong>${r.student_nom}</strong></div>
            <div style="font-size: 11px; color: #8C7F78; margin-top: 4px;">Codi reserva: <code>${r.id}</code></div>
          </div>
        </div>

        <!-- Estat Notificació Push -->
        <div id="push-status-box" style="margin-bottom: 18px; font-size: 12px; padding: 9px 12px; border-radius: 10px; background: ${hasPush ? '#E8F5E9' : '#FFF3E0'}; color: ${hasPush ? '#2E7D32' : '#E65100'}; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
          ${hasPush 
            ? '<span>🔔 Notificació Push enviada al teu telèfon/navegador!</span>' 
            : '<span id="btn-request-push-cta" style="cursor: pointer; text-decoration: underline;">🔔 Clica aquí per activar notificacions push de confirmació</span>'}
        </div>

        <!-- Coordinació amb Calendaris -->
        <div style="margin-bottom: 20px;">
          <p style="font-size: 12px; font-weight: 700; color: var(--color-dark, #2C2523); margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.5px;">Coordinar amb el teu Calendari:</p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <a href="${gcalUrl}" target="_blank" rel="noopener noreferrer" class="btn" style="background: #4285F4; color: #FFFFFF; font-weight: 700; padding: 11px 14px; border-radius: 10px; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; box-shadow: 0 2px 6px rgba(66,133,244,0.3);">
              <span>📅</span> Afegir al meu Google Calendar
            </a>
            <button type="button" id="btn-download-ics" class="btn" style="background: #FFFFFF; color: #2C2523; border: 1.5px solid #D1C7BD; font-weight: 700; padding: 11px 14px; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px;">
              <span>🍏</span> Afegir a Apple Calendar / Outlook (.ics)
            </button>
          </div>
        </div>

        <!-- Tancar -->
        <button type="button" id="btn-close-success-modal" class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 14px; font-weight: 800; border-radius: 12px;">
          D'acord, Moltes Gràcies
        </button>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeSuccess = () => {
      backdrop.remove();
    };

    backdrop.querySelector('#btn-close-success-modal')?.addEventListener('click', closeSuccess);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSuccess();
    });

    backdrop.querySelector('#btn-download-ics')?.addEventListener('click', () => {
      ReservesCalendar.downloadICS(r);
    });

    backdrop.querySelector('#btn-request-push-cta')?.addEventListener('click', async () => {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          ReservesCalendar.sendBookingPush(r);
          const box = backdrop.querySelector('#push-status-box');
          if (box) {
            box.style.background = '#E8F5E9';
            box.style.color = '#2E7D32';
            box.innerHTML = '<span>🔔 Notificació Push activada i enviada!</span>';
          }
        }
      }
    });
  }

  static async sendBookingPush(r) {
    if (!r || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;

    const title = `🏺 Reserva Confirmada - Roig de Coure`;
    const body = `${r.activitat || 'Taller'} el ${r.data} (${r.hora_inici} - ${r.hora_fi})\nAlumne: ${r.student_nom} (${r.places || 1} ${(r.places || 1) === 1 ? 'plaça' : 'places'})`;
    const options = {
      body: body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: `reserva-${r.id}`,
      renotify: true,
      data: {
        url: './alumne.html',
        reservaId: r.id
      }
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, options);
          return true;
        }
      }
      new Notification(title, options);
      return true;
    } catch (e) {
      console.warn('Avís llançant notificació push:', e);
      return false;
    }
  }

  static downloadICS(r) {
    if (!r) return;
    const startClean = (r.data || '').replace(/-/g, '') + 'T' + (r.hora_inici || '10:00').replace(/:/g, '') + '00';
    const endClean = (r.data || '').replace(/-/g, '') + 'T' + (r.hora_fi || '11:30').replace(/:/g, '') + '00';
    const uid = (r.id || `res-${Date.now()}`) + '@roigdecoure.cat';
    const nowClean = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const act = r.activitat || 'Taller de Ceràmica';
    const nom = r.student_nom || 'Alumne';
    const places = r.places || 1;

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Taller de Ceramica Roig de Coure//Reserves//CA',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${nowClean}`,
      `DTSTART:${startClean}`,
      `DTEND:${endClean}`,
      `SUMMARY:🏺 ${act} - Taller Roig de Coure`,
      `DESCRIPTION:Reserva al Taller de Ceràmica Roig de Coure\\nAlumne: ${nom}\\nActivitat: ${act}\\nPlaces: ${places}\\nID: ${r.id}`,
      'LOCATION:Taller de Ceràmica Roig de Coure',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Recordatori: tens classe de ceramica en 2 hores!',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ];

    const icsBlob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(icsBlob);
    link.download = `reserva-roigdecoure-${r.id || 'taller'}.ics`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }, 500);
  }
}

// Exportar globalment
if (typeof window !== 'undefined') {
  window.ReservesCalendar = ReservesCalendar;
}

