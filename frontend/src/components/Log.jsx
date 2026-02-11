import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useTranslation } from '../i18n/LanguageContext';

function Log() {
  const [logs, setLogs] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const { t, lang } = useTranslation();

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/logs`);
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  const formatDate = (dateString) => {
    // SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC.
    // We replace space with 'T' and add 'Z' to ensure JS parses it as UTC.
    const utcDateString = dateString.replace(' ', 'T') + 'Z';
    const date = new Date(utcDateString);
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTagColor = (type) => {
    const colors = {
      agent: '#3b82f6',
      task: '#10b981',
      document: '#f59e0b',
      system: '#8b5cf6'
    };
    return colors[type] || '#6b7280';
  };

  const getTagLabel = (type) => {
    const labels = {
      agent: t('log.tagAgent'),
      task: t('log.tagTask'),
      document: t('log.tagDocument'),
      system: t('log.tagSystem')
    };
    return labels[type] || type;
  };

  const filters = [
    { value: 'all', label: t('log.filterAll') },
    { value: 'agent', label: t('log.filterAgent') },
    { value: 'task', label: t('log.filterTask') },
    { value: 'document', label: t('log.filterDocs') },
    { value: 'system', label: t('log.filterSystem') }
  ];

  const filteredLogs = logs
    .filter(log => log.type !== 'status')
    .filter(log => activeFilter === 'all' || log.type === activeFilter);

  return (
    <div className="log-container">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 className="log-head-title">{t('log.title')}</h1>
        <p className="log-head-subtitle">{t('log.subtitle')}</p>
      </div>

      <div className="log-filters">
        {filters.map(filter => (
          <button
            key={filter.value}
            onClick={() => setActiveFilter(filter.value)}
            className={`log-filter-btn ${activeFilter === filter.value ? 'active' : ''}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="timeline">
        {filteredLogs.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: '#6b7280',
            padding: '3rem 0'
          }}>
            {t('log.noLogs')}
          </div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className="log-entry">
              <div className="log-entryRow" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span
                  className="log-tag"
                  style={{
                    backgroundColor: getTagColor(log.type) + '20',
                    color: getTagColor(log.type),
                    borderColor: `${getTagColor(log.type)}40`,
                  }}
                >
                  {getTagLabel(log.type)}
                </span>
                <span className="log-time">{formatDate(log.created_at)}</span>
              </div>

              <div className="log-entryRow log-line">
                <span className="log-lineTitle">{log.title}</span>
                {log.description && (
                  <>
                    <span className="log-lineSep">-</span>
                    <span className="log-lineDesc">{log.description}</span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Log;
