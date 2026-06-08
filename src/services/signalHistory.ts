/**
 * Signal History Service
 * Saves last 5 perfect signals to localStorage
 * Used for audit trail and historical analysis
 */

export interface SignalRecord {
  id: string;              // unique ID (timestamp + ticker)
  timestamp: string;       // ISO timestamp when signal triggered
  ticker: string;
  sector: string;
  rallyScore: number;
  top8Score: number;
  trailingTight: string;
  trailingMedium: string;
  marketOpen: boolean;     // was market open when detected?
  isAlarm: boolean;        // was it a red alarm (bearish)?
}

const STORAGE_KEY = 'emrr_signal_history';
const MAX_SIGNALS = 5;

class SignalHistoryService {
  /**
   * Add new signal to history
   * Keeps only last 5
   */
  addSignal(signal: Omit<SignalRecord, 'id' | 'timestamp'>): SignalRecord {
    const id = `${Date.now()}-${signal.ticker}`;
    const record: SignalRecord = {
      ...signal,
      id,
      timestamp: new Date().toISOString(),
    };

    const history = this.getHistory();
    history.unshift(record); // Add to front
    history.splice(MAX_SIGNALS); // Keep only last 5

    // Protegido: en modo privado o con cuota llena, setItem lanza — no debe
    // tumbar la app por guardar el histórico.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      console.log('✅ Signal saved to history:', record.ticker);
    } catch (err) {
      console.warn('No se pudo guardar el histórico de señales (localStorage no disponible):', err);
    }
    return record;
  }

  /**
   * Get last 5 signals
   */
  getHistory(): SignalRecord[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      console.error('Failed to read signal history');
      return [];
    }
  }

  /**
   * Clear history
   */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    console.log('✅ Signal history cleared');
  }

  /**
   * Get signals from last N hours
   */
  getRecent(hours: number = 24): SignalRecord[] {
    const now = Date.now();
    const cutoff = now - hours * 60 * 60 * 1000;
    return this.getHistory().filter(s => new Date(s.timestamp).getTime() > cutoff);
  }

  /**
   * Export history as CSV
   */
  exportCSV(): string {
    const history = this.getHistory();
    const headers = ['Date', 'Ticker', 'Sector', 'Rally Score', 'TOP8 Score', 'Trailing Tight', 'Trailing Medium', 'Market', 'Status'];
    const rows = history.map(s => [
      new Date(s.timestamp).toLocaleString('es-ES'),
      s.ticker,
      s.sector,
      s.rallyScore,
      s.top8Score.toFixed(1),
      s.trailingTight,
      s.trailingMedium,
      s.marketOpen ? 'ABIERTO' : 'CERRADO',
      s.isAlarm ? 'BEARISH' : 'BULLISH',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${v}"`).join(',')),
    ].join('\n');

    return csv;
  }
}

export const signalHistory = new SignalHistoryService();
