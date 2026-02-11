import { marked } from 'marked';
import { useEffect, useState, useMemo } from 'react';
import { API_BASE_URL } from '../config';
import { useTranslation } from '../i18n/LanguageContext';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Sortable Item Component ---
function SortableDocItem({ doc, selectedDoc, selectDoc, togglePin, getCategoryIcon, getCategoryColor, isReorderMode, t }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: doc.id,
    disabled: !isReorderMode
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`doc-item ${selectedDoc?.id === doc.id ? 'active' : ''} ${doc.is_pinned ? 'pinned' : ''}`}
      onClick={() => selectDoc(doc)}
    >
      {isReorderMode && !doc.isSystem && (
        <div className="drag-handle" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
          ⠿
        </div>
      )}
      <span style={{ fontSize: '1.25rem' }}>{getCategoryIcon(doc.category)}</span>
      <div className="doc-item-title-container">
        <div className="doc-item-title">{doc.title}</div>
        <div className="doc-item-subtitle">
          <span className="doc-item-category-tag" style={{
            backgroundColor: getCategoryColor(doc.category) + '20',
            color: getCategoryColor(doc.category),
            border: `1px solid ${getCategoryColor(doc.category)}40`
          }}>
            {doc.category}
          </span>
          <span>{new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>
      {!doc.isSystem && (
        <button
          className={`pin-btn ${doc.is_pinned ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(doc);
          }}
          title={doc.is_pinned ? t('docs.unstar') : t('docs.starToTop')}
        >
          {doc.is_pinned ? '★' : '☆'}
        </button>
      )}
    </div>
  );
}

// --- Main Docs Component ---
function Docs() {
  const [docs, setDocs] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSystemCollapsed, setIsSystemCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const { t, lang } = useTranslation();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetchDocs();
  }, []);

  const fetchDocs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs`);
      const data = await res.json();
      const normalized = (data || []).map(d => ({
        ...d,
        isSystem: d?.category === 'System' || d?.category === 'Workspace' || String(d?.title || '').startsWith('System /')
      }));
      setDocs(normalized);
      if (normalized.length > 0 && !selectedDoc) {
        const firstUserDoc = normalized.find(d => !d.isSystem);
        selectDoc(firstUserDoc || normalized[0]);
      }
    } catch (err) {
      console.error('Failed to fetch docs:', err);
    }
  };

  const selectDoc = async (doc) => {
    setSelectedDoc(doc);
    setIsEditing(false);
    setEditTitle(doc.title);
    setSidebarOpen(false);
    try {
      const contentUrl = (doc.id.startsWith('file:') || doc.id.startsWith('docs:'))
        ? `${API_BASE_URL}/api/docs/content?id=${encodeURIComponent(doc.id)}`
        : `${API_BASE_URL}/api/docs/${doc.id}/content`;
      const res = await fetch(contentUrl);
      const data = await res.json();
      setEditContent(data.content || '');
    } catch (err) {
      console.error('Failed to fetch doc content:', err);
      setEditContent('');
    }
  };

  const togglePin = async (doc) => {
    try {
      const newPinned = !doc.is_pinned;
      const res = await fetch(`${API_BASE_URL}/api/docs/${doc.id}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: newPinned })
      });
      if (res.ok) await fetchDocs();
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = docs.findIndex((d) => d.id === active.id);
    const newIndex = docs.findIndex((d) => d.id === over.id);
    if (docs[oldIndex].is_pinned !== docs[newIndex].is_pinned) return;
    const newDocs = arrayMove(docs, oldIndex, newIndex);
    setDocs(newDocs);
    const userDocs = newDocs.filter(d => !d.isSystem);
    const orders = userDocs.map((doc, idx) => ({ id: doc.id, sort_order: idx }));
    try {
      await fetch(`${API_BASE_URL}/api/docs/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders })
      });
    } catch (err) {
      console.error('Failed to save reorder:', err);
      fetchDocs();
    }
  };

  const updateDoc = async () => {
    if (!editTitle.trim()) { alert(t('docs.enterTitle')); return; }
    try {
      const isFileDoc = selectedDoc.id.startsWith('file:') || selectedDoc.id.startsWith('docs:');
      const url = isFileDoc
        ? `${API_BASE_URL}/api/docs/file`
        : `${API_BASE_URL}/api/docs/${selectedDoc.id}`;
      const body = isFileDoc
        ? { id: selectedDoc.id, title: editTitle, content: editContent }
        : { title: editTitle, content: editContent };
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Failed to update document');
      setIsEditing(false);
      await fetchDocs();
    } catch (err) {
      console.error('Failed to update doc:', err);
      alert(t('docs.updateFailed'));
    }
  };

  const deleteDoc = async () => {
    if (!confirm(t('docs.deleteConfirm'))) return;
    try {
      await fetch(`${API_BASE_URL}/api/docs/${selectedDoc.id}`, { method: 'DELETE' });
      fetchDocs();
      setSelectedDoc(null);
    } catch (err) {
      console.error('Failed to delete doc:', err);
    }
  };

  const getCategoryIcon = (category) => {
    const icons = {
      'Guide': '📚',
      'Security': '🔒',
      'Reference': '💡',
      'AI Pulse': '📰',
      'System': '⚙️',
      'Project': '📺',
      'Docs': '📄',
      'Template': '🧩',
      'Research': '🔍'
    };
    return icons[category] || '📄';
  };

  const getCategoryColor = (category) => {
    const colors = {
      'Guide': '#3b82f6',
      'Security': '#ef4444',
      'Reference': '#10b981',
      'AI Pulse': '#f59e0b',
      'System': '#8b5cf6',
      'Project': '#06b6d4',
      'Docs': '#94a3b8',
      'Template': '#ec4899',
      'Research': '#10b981'
    };
    return colors[category] || '#6b7280';
  };

  const dateLocale = lang === 'zh' ? 'zh-CN' : 'en-US';

  const filteredDocs = docs.filter(doc => doc.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const systemDocs = filteredDocs.filter(d => d.isSystem);
  const userDocs = filteredDocs.filter(d => !d.isSystem);

  return (
    <>
      <div className="docs-container">
        <div className={`docs-sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />
        <div className={`docs-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="docs-header-section" style={{ marginBottom: '0.5rem' }}>
            <div className="docs-header-title-container">
              <h3 className="docs-header-title">{t('docs.documents')}</h3>
              <button
                className={`edit-mode-btn-small ${isReorderMode ? 'active' : ''}`}
                onClick={() => setIsReorderMode(!isReorderMode)}
              >
                {isReorderMode ? t('docs.done') : t('docs.edit')}
              </button>
            </div>

            <div className="search-box" style={{ marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.50)' }}>🔍</span>
              <input
                type="text"
                placeholder={t('docs.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.92)', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div className="docs-list">
            <div className="docs-section-header" onClick={() => setIsSystemCollapsed(!isSystemCollapsed)}>
              <span>{t('docs.systemDocuments')}</span>
              <span>{isSystemCollapsed ? '▶' : '▼'}</span>
            </div>
            {!isSystemCollapsed && systemDocs.map(doc => (
              <div key={doc.id} className={`doc-item system-doc ${selectedDoc?.id === doc.id ? 'active' : ''}`} onClick={() => selectDoc(doc)}>
                <span style={{ fontSize: '1.2rem' }}>{getCategoryIcon(doc.category)}</span>
                <div className="doc-item-title-container">
                  <div className="doc-item-title">{doc.title}</div>
                  <div className="doc-item-subtitle">
                    <span className="doc-item-category-tag" style={{ backgroundColor: getCategoryColor(doc.category) + '20', color: getCategoryColor(doc.category), border: `1px solid ${getCategoryColor(doc.category)}40` }}>{doc.category}</span>
                  </div>
                </div>
              </div>
            ))}
            <div className="doc-divider"></div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={userDocs.map(d => d.id)} strategy={verticalListSortingStrategy}>
                {userDocs.map(doc => (
                  <SortableDocItem key={doc.id} doc={doc} selectedDoc={selectedDoc} selectDoc={selectDoc} togglePin={togglePin} getCategoryIcon={getCategoryIcon} getCategoryColor={getCategoryColor} isReorderMode={isReorderMode} t={t} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        <div className="docs-content">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open document list">☰</button>
          {selectedDoc ? (
            isEditing ? (
              <>
                <div className="doc-edit-header">
                  <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="doc-title-edit" placeholder={t('docs.titlePlaceholder')} />
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>{t('docs.cancel')}</button>
                    <button className="btn btn-primary" onClick={updateDoc}>{t('docs.save')}</button>
                  </div>
                </div>
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="doc-content-edit" placeholder={t('docs.contentPlaceholder')} />
              </>
            ) : (
              <>
                <div className="doc-view-header">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '1.5rem' }}>{getCategoryIcon(selectedDoc.category)}</span>
                      <h1 style={{ fontSize: '1.75rem', fontWeight: 600 }}>{selectedDoc.title}</h1>
                      {selectedDoc.is_pinned ? <span title="Starred" style={{ color: '#f59e0b' }}>★</span> : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: '#9ca3af', fontSize: '0.875rem' }}>
                      <span>{new Date(selectedDoc.created_at).toLocaleDateString(dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                      <span style={{ padding: '0.25rem 0.75rem', borderRadius: '6px', backgroundColor: getCategoryColor(selectedDoc.category) + '20', color: getCategoryColor(selectedDoc.category), fontSize: '0.75rem', fontWeight: '600', border: `1px solid ${getCategoryColor(selectedDoc.category)}40` }}>{selectedDoc.category}</span>
                    </div>
                  </div>
                  <div className="doc-view-actions">
                    {!selectedDoc.isSystem && (
                      <>
                        <button className="btn btn-secondary" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)' }} onClick={deleteDoc}>{t('docs.delete')}</button>
                        <button className="btn btn-primary" onClick={() => setIsEditing(true)}>{t('docs.editDoc')}</button>
                      </>
                    )}
                  </div>
                </div>
                <div className="doc-divider"></div>
                <div className="doc-content-view" dangerouslySetInnerHTML={{ __html: marked(editContent || '') }} />
              </>
            )
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>{t('docs.selectDoc')}</div>
          )}
        </div>
      </div>
    </>
  );
}

export default Docs;
