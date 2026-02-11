import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';
import { useTranslation } from '../i18n/LanguageContext';

function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    status: 'todo',
    priority: 'medium'
  });
  const { t, lang } = useTranslation();

  // Responsive behavior
  const [isMobile, setIsMobile] = useState(false);

  // Archive UI: collapse by default (show first 3), with expand toggle
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  // Mobile-only collapse toggles for other columns
  const [todoExpanded, setTodoExpanded] = useState(false);
  const [inProgressExpanded, setInProgressExpanded] = useState(false);
  const [doneExpanded, setDoneExpanded] = useState(false);

  // Preserve per-column scroll position (prevents jump-to-top when App re-renders/polls)
  const columnScrollRefs = useRef({});
  const columnScrollTops = useRef({});

  useEffect(() => {
    fetchTasks();

    // Local realtime refresh (no polling): listen for SSE events from backend
    // Falls back silently if unsupported/unreachable.
    let es;
    try {
      es = new EventSource(`${API_BASE_URL}/api/events`, { withCredentials: true });
      const onTasksUpdated = () => fetchTasks();
      es.addEventListener('tasksUpdated', onTasksUpdated);
    } catch (_) {
      // ignore
    }

    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setIsMobile(!!mq.matches);
    apply();

    // Keep updated when resizing/devtools responsive mode changes
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else mq.addListener(apply);

    return () => {
      try { es && es.close(); } catch (_) { }
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else mq.removeListener(apply);
    };
  }, []);

  useLayoutEffect(() => {
    // Restore scroll positions after any re-render that might affect layout.
    for (const [status, el] of Object.entries(columnScrollRefs.current)) {
      if (!el) continue;
      const top = columnScrollTops.current[status];
      if (typeof top === 'number') el.scrollTop = top;
    }
  });

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/tasks`);
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  const addTask = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTask)
      });
      const data = await res.json();
      setTasks([...tasks, data]);
      setShowModal(false);
      setNewTask({ title: '', description: '', status: 'todo', priority: 'medium' });
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const updateTaskStatus = async (id, newStatus) => {
    try {
      await fetch(`${API_BASE_URL}/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      fetchTasks();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const updateTask = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/tasks/${editingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingTask.title,
          description: editingTask.description,
          priority: editingTask.priority,
          status: editingTask.status
        })
      });
      fetchTasks();
      setShowEditModal(false);
      setEditingTask(null);
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const deleteTask = async (id) => {
    if (!confirm(t('dashboard.deleteConfirm'))) return;
    try {
      await fetch(`${API_BASE_URL}/api/tasks/${id}`, {
        method: 'DELETE'
      });
      fetchTasks();
      setShowEditModal(false);
      setEditingTask(null);
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const openEditModal = (task) => {
    setEditingTask({
      ...task,
      priority: task.priority || 'medium'
    });
    setShowEditModal(true);
  };

  const toggleTaskCheck = async (id, checked) => {
    try {
      await fetch(`${API_BASE_URL}/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked })
      });
      fetchTasks();
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  };

  const getTasksByStatus = (status) => {
    return tasks.filter(task => task.status === status);
  };

  const dateLocale = lang === 'zh' ? 'zh-CN' : 'en-US';

  const KanbanColumn = ({ title, status, statusClass, tasks, isArchive }) => {
    // Archive: always collapses when >3 (all screen sizes)
    // Other columns: collapse ONLY on mobile
    const isMobileCollapsible = isMobile && !isArchive;

    const expanded = isArchive
      ? archiveExpanded
      : (status === 'todo' ? todoExpanded : status === 'in_progress' ? inProgressExpanded : status === 'done' ? doneExpanded : true);

    const shouldCollapse = (isArchive || isMobileCollapsible) && tasks.length > 3;
    const visibleTasks = shouldCollapse && !expanded ? tasks.slice(0, 3) : tasks;

    const canShowToggle = shouldCollapse;

    const toggle = () => {
      if (isArchive) return setArchiveExpanded(v => !v);
      if (!isMobileCollapsible) return;
      if (status === 'todo') return setTodoExpanded(v => !v);
      if (status === 'in_progress') return setInProgressExpanded(v => !v);
      if (status === 'done') return setDoneExpanded(v => !v);
    };

    return (
      <div className={`kanban-column ${isArchive ? 'archive' : ''}`}>
        <div className="column-header">
          <div className="column-title">
            <div className={`status-dot ${statusClass}`}></div>
            {title}
          </div>
          <div className="column-count">{tasks.length}</div>
        </div>
        <button
          className="add-task-btn"
          onClick={(e) => {
            e.stopPropagation();
            setNewTask({ ...newTask, status });
            setShowModal(true);
          }}
        >
          +
        </button>
        <div
          className="column-tasks"
          ref={(el) => { columnScrollRefs.current[status] = el; }}
          onScroll={(e) => { columnScrollTops.current[status] = e.currentTarget.scrollTop; }}
        >
          {visibleTasks.map(task => (
            <div
              key={task.id}
              className={`task-card status-${task.status} ${task.checked ? 'checked' : ''}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('taskId', task.id)}
              onClick={() => openEditModal(task)}
            >
              <div className="task-card-header">
                <div className={`task-indicator status-${task.status}`} style={{ color: `var(--${task.status === 'done' ? 'green' : task.status === 'in_progress' ? 'orange' : 'primary'})` }}></div>
                <span className={`priority-badge ${task.priority || 'medium'}`}>
                  {task.priority === 'high' ? 'H' : task.priority === 'low' ? 'L' : 'M'}
                </span>
              </div>

              <div className="task-title">{task.title}</div>

              {task.description && (
                <div className="task-desc">{task.description}</div>
              )}

              <div className="task-meta">
                <span>{new Date(task.created_at).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}</span>
                <span style={{ opacity: 0.4, fontWeight: 800, fontSize: '0.6rem', fontFamily: 'var(--font-mono)' }}>ID-{task.id}</span>
              </div>
            </div>
          ))}

          {canShowToggle && (
            <button
              className="archive-toggle-btn"
              onClick={(e) => {
                e.stopPropagation();
                const wasExpanded = expanded;
                toggle();

                // If collapsing, keep user near the top of the column
                if (wasExpanded) {
                  columnScrollTops.current[status] = 0;
                  const el = columnScrollRefs.current[status];
                  if (el) el.scrollTop = 0;
                }
              }}
            >
              {expanded ? t('dashboard.collapse') : `${t('dashboard.showAll')} (${tasks.length})`}
            </button>
          )}
        </div>
      </div>
    );
  };

  const getStatusLabel = (statusKey) => {
    const map = {
      'todo': t('dashboard.todo'),
      'in_progress': t('dashboard.inProgress'),
      'done': t('dashboard.done'),
      'archive': t('dashboard.archive'),
    };
    return map[statusKey] || statusKey.replace('_', ' ');
  };

  return (
    <>
      <div className="kanban-board">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const taskId = e.dataTransfer.getData('taskId');
            updateTaskStatus(taskId, 'todo');
          }}
        >
          <KanbanColumn
            title={t('dashboard.todo')}
            status="todo"
            statusClass="status-todo"
            tasks={getTasksByStatus('todo')}
          />
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const taskId = e.dataTransfer.getData('taskId');
            updateTaskStatus(taskId, 'in_progress');
          }}
        >
          <KanbanColumn
            title={t('dashboard.inProgress')}
            status="in_progress"
            statusClass="status-progress"
            tasks={getTasksByStatus('in_progress')}
          />
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const taskId = e.dataTransfer.getData('taskId');
            updateTaskStatus(taskId, 'done');
          }}
        >
          <KanbanColumn
            title={t('dashboard.done')}
            status="done"
            statusClass="status-done"
            tasks={getTasksByStatus('done')}
          />
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const taskId = e.dataTransfer.getData('taskId');
            updateTaskStatus(taskId, 'archive');
          }}
        >
          <KanbanColumn
            title={t('dashboard.archive')}
            status="archive"
            statusClass="status-archive"
            tasks={getTasksByStatus('archive')}
            isArchive={true}
          />
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('dashboard.newTask')}</h2>
            <div className="modal-subtitle">
              <span>{t('dashboard.addingTo')}</span>
              <div className={`modal-status-indicator status-${newTask.status}`}></div>
              <span style={{ textTransform: 'capitalize' }}>
                {getStatusLabel(newTask.status)}
              </span>
            </div>

            <div className="form-group">
              <label>{t('dashboard.title')}</label>
              <input
                type="text"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder={t('dashboard.titlePlaceholder')}
              />
            </div>

            <div className="form-group">
              <label>{t('dashboard.notes')}</label>
              <textarea
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder={t('dashboard.notesPlaceholder')}
              />
            </div>

            <div className="form-group">
              <label>{t('dashboard.priority')}</label>
              <div className="priority-group">
                <button
                  type="button"
                  className={`priority-btn ${newTask.priority === 'high' ? 'active high' : ''}`}
                  onClick={() => setNewTask({ ...newTask, priority: 'high' })}
                >
                  {t('dashboard.high')}
                </button>
                <button
                  type="button"
                  className={`priority-btn ${newTask.priority === 'medium' ? 'active medium' : ''}`}
                  onClick={() => setNewTask({ ...newTask, priority: 'medium' })}
                >
                  {t('dashboard.medium')}
                </button>
                <button
                  type="button"
                  className={`priority-btn ${newTask.priority === 'low' ? 'active low' : ''}`}
                  onClick={() => setNewTask({ ...newTask, priority: 'low' })}
                >
                  {t('dashboard.low')}
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                {t('dashboard.cancel')}
              </button>
              <button className="btn btn-primary" onClick={addTask}>
                {t('dashboard.add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingTask && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('dashboard.editTask')}</h2>
            <div className="modal-subtitle">
              <span>{t('dashboard.status')}</span>
              <div className={`modal-status-indicator status-${editingTask.status}`}></div>
              <span style={{ textTransform: 'capitalize' }}>
                {getStatusLabel(editingTask.status)}
              </span>
            </div>

            <div className="form-group">
              <label>{t('dashboard.title')}</label>
              <input
                type="text"
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                placeholder={t('dashboard.titlePlaceholder')}
              />
            </div>

            <div className="form-group">
              <label>{t('dashboard.notes')}</label>
              <textarea
                value={editingTask.description || ''}
                onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                placeholder={t('dashboard.notesPlaceholder')}
              />
            </div>

            <div className="form-group">
              <label>{t('dashboard.priority')}</label>
              <div className="priority-group">
                <button
                  type="button"
                  className={`priority-btn ${editingTask.priority === 'high' ? 'active high' : ''}`}
                  onClick={() => setEditingTask({ ...editingTask, priority: 'high' })}
                >
                  {t('dashboard.high')}
                </button>
                <button
                  type="button"
                  className={`priority-btn ${editingTask.priority === 'medium' ? 'active medium' : ''}`}
                  onClick={() => setEditingTask({ ...editingTask, priority: 'medium' })}
                >
                  {t('dashboard.medium')}
                </button>
                <button
                  type="button"
                  className={`priority-btn ${editingTask.priority === 'low' ? 'active low' : ''}`}
                  onClick={() => setEditingTask({ ...editingTask, priority: 'low' })}
                >
                  {t('dashboard.low')}
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                style={{ background: '#dc2626', borderColor: '#dc2626', color: 'white' }}
                onClick={() => deleteTask(editingTask.id)}
              >
                {t('dashboard.delete')}
              </button>
              <div style={{ flex: 1 }}></div>
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>
                {t('dashboard.cancel')}
              </button>
              <button className="btn btn-primary" onClick={updateTask}>
                {t('dashboard.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Dashboard;
