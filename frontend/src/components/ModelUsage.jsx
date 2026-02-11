import { useState, useEffect } from 'react';

const ModelUsage = () => {
  const [models, setModels] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/models');
        const json = await res.json();
        if (json.success) {
          const filtered = json.data.filter(m => !m.model.toLowerCase().includes('opus'));
          setModels(filtered);
        }
      } catch (err) { console.error(err); }
    };

    fetchModels();
    const interval = setInterval(fetchModels, 30000); 
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, []);

  const formatCD = (resetTime) => {
    if (!resetTime) return '';
    const diff = new Date(resetTime).getTime() - now;
    if (diff <= 0) return '';
    
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getDisplayName = (model) => {
    const m = model.toLowerCase();
    if (m.includes('pro-high')) return 'Gemini 3 Pro High';
    if (m.includes('pro-low')) return 'Gemini 3 Pro Low';
    if (m.includes('pro-preview') || m === 'gemini-3-pro') return 'Gemini 3 Pro';
    if (m.includes('flash')) return 'Gemini 3 Flash';
    if (m === 'gpt-5.2-codex') return 'Gpt 5.2 Codex';
    if (m === 'gpt-5.2') return 'Gpt 5.2';
    return model.split('/').pop();
  };

  const grouped = models.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});

  const providerNames = {
    'google-antigravity': 'Google Antigravity',
    'google-gemini-cli': 'Google Gemini CLI',
    'openai-codex': 'OpenAI Codex'
  };

  const styles = {
    container: {
      width: '100%',
      marginTop: '10px',
      padding: '4px 8px',
      background: 'transparent',
      border: 'none',
      color: 'var(--text)',
      boxShadow: 'none'
    },
    providerGroup: { marginBottom: '10px' },
    providerHeader: {
      fontSize: '0.6rem',
      fontWeight: '700',
      color: 'var(--primary)',
      marginBottom: '4px',
      opacity: 0.8,
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    item: { marginBottom: '6px', paddingLeft: '2px' },
    header: { 
      display: 'flex', 
      justifyContent: 'space-between', 
      marginBottom: '2px',
      alignItems: 'center'
    },
    modelName: { 
      fontWeight: '500', 
      color: 'var(--text)', 
      fontSize: '0.65rem',
      opacity: 0.85
    },
    cd: { 
      fontSize: '0.6rem', 
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)'
    },
    barBg: {
      height: '3px',
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '2px',
      overflow: 'hidden'
    },
    barFill: (pct) => ({
      height: '100%',
      width: `${pct}%`,
      background: pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--orange)' : 'var(--red)',
      borderRadius: '2px',
      transition: 'width 0.8s ease'
    }),
    footer: {
      display:'flex', 
      justifyContent:'space-between', 
      fontSize:'0.55rem', 
      color:'var(--dim)', 
      marginTop:'1px',
      opacity: 0.8
    }
  };

  return (
    <div style={styles.container}>
      {Object.entries(grouped).map(([provider, providerModels]) => (
        <div key={provider} style={styles.providerGroup}>
          <div style={styles.providerHeader}>
            {providerNames[provider] || provider}
          </div>
          {providerModels.map(m => (
            <div key={m.model} style={styles.item}>
              <div style={styles.header}>
                <span style={styles.modelName}>{getDisplayName(m.model)}</span>
                <span style={styles.cd}>{formatCD(m.cd_reset)}</span>
              </div>
              <div style={styles.barBg}>
                <div style={styles.barFill(m.usage_pct)}></div>
              </div>
              <div style={styles.footer}>
                <span>{m.usage_pct}%</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default ModelUsage;
