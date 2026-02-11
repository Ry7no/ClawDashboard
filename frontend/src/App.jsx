import { useEffect, useState } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import Docs from './components/Docs';
import FoxAvatar from './components/FoxAvatar';
import Log from './components/Log';
import ModelUsage from './components/ModelUsage';
import { LanguageProvider, useTranslation } from './i18n/LanguageContext';

import { API_BASE_URL, FEATURES } from './config';

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [status, setStatus] = useState('idle');
  const [activeAgent, setActiveAgent] = useState('Claw');
  const [isConnected, setIsConnected] = useState(true);
  const [lastSync, setLastSync] = useState(new Date());
  const [agents, setAgents] = useState([]);
  const { t, lang, setLang } = useTranslation();

  useEffect(() => {
    // Poll status from backend
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/status`);
        if (!res.ok) throw new Error('Disconnected');
        const data = await res.json();
        setStatus(data.status || 'idle');
        setActiveAgent(data.activeAgent || 'Claw');
        setIsConnected(true);
        setLastSync(new Date());
      } catch (err) {
        console.error('Failed to fetch status:', err);
        setIsConnected(false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Fetch agents list from backend
    const loadAgents = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/agents`);
        const data = await res.json();
        setAgents(data?.data || []);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setAgents([]);
      }
    };
    loadAgents();
  }, []);

  const formatTime = (date) => {
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: lang !== 'zh'
    });
  };

  const getProcessingClass = (status) => {
    const s = (status || 'idle').toLowerCase();
    if (s === 'thinking') return 'status-idle'; // Yellow
    if (s === 'acting') return 'status-busy';   // Red
    return 'status-online';                      // Green (Idle)
  };

  const formatStatusLabel = (status) => {
    const s = (status || 'idle').toLowerCase();
    if (s === 'thinking') return t('app.thinking');
    if (s === 'acting') return t('app.acting');
    return t('app.idle');
  };

  const getConnectionClass = () => {
    return isConnected ? 'status-online' : 'status-busy'; // Green/Red
  };

  const getAgentLabel = (isActive, statusStr) => {
    if (!isActive) return t('app.agentStandby');
    return statusStr.toLowerCase() === 'thinking' ? t('app.agentThinking') : t('app.agentActing');
  };

  const agentsOnDuty = (agents || []).map(a => {
    const isActive = activeAgent === a.name && status.toLowerCase() !== 'idle';
    return {
      name: a.name,
      role: a.role || 'Agent',
      emoji: a.emoji || '🤖',
      status: isActive ? 'busy' : 'standby',
      label: getAgentLabel(isActive, status)
    };
  });

  const toggleLang = () => {
    setLang(lang === 'en' ? 'zh' : 'en');
  };

  return (
    <div className="app">
      {/* Sidebar / Top Bar */}
      <div className="sidebar">
        <div className="sidebar-top-main">
          <div className="profile">
            <FoxAvatar status={status} />
            <div className={`status-indicator ${getConnectionClass()}`}></div>
          </div>
          <div className="mobile-status-pill">
            <div className={`status-dot ${getProcessingClass(status)}`}></div>
            <span>{status.toUpperCase()}</span>
          </div>

          <div className="sidebar-mobile-right">
            <div className="sidebar-last-sync">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              {formatTime(lastSync)}
            </div>
          </div>
        </div>

        <div className="sidebar-status-panel glass">
          <div className="status-row">
            <div className={`status-dot ${getProcessingClass(status)}`}></div>
            <span className="status-label">{formatStatusLabel(status)}</span>
          </div>
          <div className="task-current">
            {status.toLowerCase() === 'thinking' ? t('app.thinkingTask') :
              status.toLowerCase() === 'acting' ? t('app.actingTask') : t('app.readyTask')}
          </div>
        </div>

        {agentsOnDuty.length > 0 && (
          <div className="sidebar-agents">
            <div className="agents-header">{t('app.teamStatus')}</div>
            <div className="agents-list">
              {agentsOnDuty.map((agent, i) => (
                <div key={i} className={`agent-item ${agent.status}`}>
                  <span className="agent-emoji">{agent.emoji}</span>
                  <div className="agent-info">
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-role">{agent.label}</span>
                  </div>
                  <div className={`agent-status-dot ${agent.status}`}></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {FEATURES.ENABLE_MODEL_USAGE && <ModelUsage />}
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Header */}
        <div className="header">
          <div className="header-info">
            <span>{t('app.lastSync')}: {formatTime(lastSync)}</span>
            <span>☀️</span>
          </div>
          <button className="lang-switch-btn" onClick={toggleLang} title="Switch language">
            <span className="lang-switch-icon">🌐</span>
            <span className="lang-switch-label">{t('lang.switch')}</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            {t('app.tab.dashboard')}
          </button>
          <button
            className={`tab ${activeTab === 'docs' ? 'active' : ''}`}
            onClick={() => setActiveTab('docs')}
          >
            {t('app.tab.docs')}
          </button>
          <button
            className={`tab ${activeTab === 'log' ? 'active' : ''}`}
            onClick={() => setActiveTab('log')}
          >
            {t('app.tab.log')}
          </button>

        </div>

        {/* Content */}
        <div className="content">
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'docs' && <Docs />}
          {activeTab === 'log' && <Log />}

        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
