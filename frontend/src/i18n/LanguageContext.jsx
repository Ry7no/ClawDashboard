import { createContext, useContext, useState, useCallback } from 'react';
import translations from './translations';

const LanguageContext = createContext();

const STORAGE_KEY = 'clawdashboard-lang';

export function LanguageProvider({ children }) {
    const [lang, setLangState] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'zh';
        } catch {
            return 'zh';
        }
    });

    const setLang = useCallback((newLang) => {
        setLangState(newLang);
        try {
            localStorage.setItem(STORAGE_KEY, newLang);
        } catch {
            // ignore
        }
    }, []);

    const t = useCallback((key) => {
        return translations[lang]?.[key] || translations['en']?.[key] || key;
    }, [lang]);

    return (
        <LanguageContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useTranslation() {
    const ctx = useContext(LanguageContext);
    if (!ctx) throw new Error('useTranslation must be used within LanguageProvider');
    return ctx;
}
