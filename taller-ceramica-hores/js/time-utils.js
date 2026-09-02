/**
 * time-utils.js - Utilitats de temps i càlculs precisos H:m:s per al Taller de Ceràmica
 */

const TimeUtils = {
  /**
   * Converteix segons totals a format "HH:MM:SS" (o "-HH:MM:SS" si és negatiu)
   * @param {number} totalSeconds
   * @returns {string} Format HH:MM:SS
   */
  secondsToHms(totalSeconds) {
    if (isNaN(totalSeconds)) return '00:00:00';
    const isNegative = totalSeconds < 0;
    const sec = Math.abs(Math.round(totalSeconds));

    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;

    const pad = (n) => String(n).padStart(2, '0');
    const formatted = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return isNegative ? `-${formatted}` : formatted;
  },

  /**
   * Converteix segons totals a format textual català amigable (ex: "2h 30m 15s")
   * @param {number} totalSeconds
   * @returns {string}
   */
  formatHmsHuman(totalSeconds) {
    if (isNaN(totalSeconds)) return '0s';
    const isNegative = totalSeconds < 0;
    const sec = Math.abs(Math.round(totalSeconds));

    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    const result = parts.join(' ');
    return isNegative ? `-${result}` : result;
  },

  /**
   * Converteix una cadena "HH:MM:SS" o "HH:MM" o un nombre decimal d'hores a segons totals
   * @param {string|number} input
   * @returns {number}
   */
  hmsToSeconds(input) {
    if (typeof input === 'number') {
      return Math.round(input * 3600);
    }
    if (!input || typeof input !== 'string') return 0;

    const clean = input.trim();
    // Si és un número decimal pur com "10.5"
    if (!isNaN(clean) && clean !== '') {
      return Math.round(parseFloat(clean) * 3600);
    }

    const parts = clean.split(':').map(p => parseInt(p, 10) || 0);
    if (parts.length === 3) {
      // HH:MM:SS
      return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    } else if (parts.length === 2) {
      // HH:MM
      return (parts[0] * 3600) + (parts[1] * 60);
    } else if (parts.length === 1) {
      return parts[0] * 3600;
    }
    return 0;
  },

  /**
   * Calcula la durada en segons entre dues dates ISO o timestamps
   * @param {string|Date} start
   * @param {string|Date} end
   * @returns {number} segons
   */
  calculateDuration(start, end) {
    if (!start) return 0;
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.max(0, Math.floor(diffMs / 1000));
  },

  /**
   * Formata una data a format català complet (DD/MM/YYYY, HH:mm:ss)
   * @param {string|Date} iso
   * @returns {string}
   */
  formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('ca-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },

  /**
   * Formata només la data (DD/MM/YYYY)
   * @param {string|Date} iso
   * @returns {string}
   */
  formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('ca-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  },

  /**
   * Formata només l'hora (HH:mm:ss)
   * @param {string|Date} iso
   * @returns {string}
   */
  formatTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ca-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },

  /**
   * Retorna l'hora local en format compatible amb input datetime-local: YYYY-MM-DDTHH:mm
   */
  toLocalDatetimeInput(date = new Date()) {
    const d = new Date(date);
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
    return local.toISOString().slice(0, 16);
  },

  /**
   * Calcula el balanç d'hores complet d'un alumne
   * @param {string} studentId
   * @param {Array} packages
   * @param {Array} sessions
   */
  calculateStudentBalance(studentId, packages = [], sessions = []) {
    const studentPacks = packages.filter(p => p.studentId === studentId);
    const studentSessions = sessions.filter(s => s.studentId === studentId && s.estat !== 'oberta');

    // Total segons comprats
    const totalBoughtSeconds = studentPacks.reduce((acc, p) => {
      const sec = p.segons !== undefined ? p.segons : Math.round((parseFloat(p.hores) || 0) * 3600);
      return acc + sec;
    }, 0);

    // Total segons consumits en sessions tancades
    const totalSpentSeconds = studentSessions.reduce((acc, s) => {
      return acc + (parseInt(s.duradaSegons, 10) || 0);
    }, 0);

    const balanceSeconds = totalBoughtSeconds - totalSpentSeconds;

    return {
      totalBoughtSeconds,
      totalSpentSeconds,
      balanceSeconds,
      formatBought: this.secondsToHms(totalBoughtSeconds),
      formatSpent: this.secondsToHms(totalSpentSeconds),
      formatBalance: this.secondsToHms(balanceSeconds),
      humanBought: this.formatHmsHuman(totalBoughtSeconds),
      humanSpent: this.formatHmsHuman(totalSpentSeconds),
      humanBalance: this.formatHmsHuman(balanceSeconds),
      isNegative: balanceSeconds < 0,
      isLow: balanceSeconds >= 0 && balanceSeconds < 7200 // menys de 2 hores
    };
  }
};

// Exportar per a mòduls o entorns globals de navegador
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TimeUtils;
}
