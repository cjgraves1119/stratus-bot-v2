/**
 * Task Panel
 * View and manage Zoho CRM tasks for the current email's account.
 */

import { useState, useEffect } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

export default function TaskPanel({ emailContext, crmContext }) {
  const [tasks, setTasks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [reschedulePrompt, setReschedulePrompt] = useState(null);

  useEffect(() => {
    if (emailContext) fetchTasks();
  }, [emailContext?.senderEmail]);

  // Listen for task reschedule prompt from background (after email sent)
  useEffect(() => {
    const handleMessage = (message) => {
      if (message.type === 'TASK_RESCHEDULE_PROMPT') {
        setReschedulePrompt(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  async function fetchTasks() {
    if (!emailContext) return;
    setLoading(true);
    setError(null);

    try {
      const result = await sendToBackground(MSG.FETCH_TASKS, {
        domains: emailContext.allDomains || [],
        emails: emailContext.allEmails || [],
      });
      setTasks(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTaskAction(action, taskId, options = {}) {
    setActionLoading(taskId);
    try {
      await sendToBackground(MSG.TASK_ACTION, { action, taskId, ...options });
      // Refresh tasks
      await fetchTasks();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  if (!emailContext) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <p>Open an email to see related tasks.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Loading tasks...
      </div>
    );
  }

  const taskList = tasks?.tasks || [];

  return (
    <div style={{ padding: 16 }}>
      {/* Email Reschedule Prompt Banner */}
      {reschedulePrompt && (
        <div style={{
          background: COLORS.STRATUS_LIGHT,
          border: `2px solid ${COLORS.STRATUS_BLUE}`,
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.STRATUS_DARK, marginBottom: 8 }}>
            Email Sent — Tasks to Reschedule
          </div>
          <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, marginBottom: 6 }}>
            <strong>To:</strong> {reschedulePrompt.recipients?.join(', ') || 'Unknown'}
          </div>
          <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, marginBottom: 8 }}>
            <strong>Subject:</strong> {reschedulePrompt.subject || 'No subject'}
          </div>
          <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, marginBottom: 12 }}>
            Found <strong>{reschedulePrompt.tasksFound || 0}</strong> open task{reschedulePrompt.tasksFound !== 1 ? 's' : ''} for this recipient.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setReschedulePrompt(null)}
              style={{
                padding: '6px 12px',
                background: COLORS.STRATUS_BLUE,
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Show Tasks Below
            </button>
            <button
              onClick={() => setReschedulePrompt(null)}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: COLORS.TEXT_SECONDARY,
                border: `1px solid ${COLORS.BORDER}`,
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>
          Tasks ({taskList.length})
        </div>
        <button
          onClick={fetchTasks}
          style={{
            padding: '4px 10px', background: 'transparent', border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 6, fontSize: 12, cursor: 'pointer', color: COLORS.TEXT_SECONDARY,
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fce8e6', borderRadius: 8, color: COLORS.ERROR, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {taskList.length === 0 && !loading && (
        <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20 }}>
          No open tasks found for this account.
        </div>
      )}

      {taskList.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          isLoading={actionLoading === task.id}
          onComplete={() => handleTaskAction('complete_and_followup', task.id, {
            dealId: task.dealId,
            contactId: task.contactId,
            newSubject: `Follow up: ${task.subject}`,
          })}
          onClose={() => handleTaskAction('complete', task.id)}
          onReschedule={() => handleTaskAction('reschedule', task.id, {
            newDueDate: addBusinessDays(new Date(), 3),
          })}
        />
      ))}
    </div>
  );
}

function TaskCard({ task, isLoading, onComplete, onClose, onReschedule }) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();

  return (
    <div style={{
      background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
      borderRadius: 8, padding: 12, marginBottom: 8,
      borderLeft: `3px solid ${isOverdue ? COLORS.ERROR : COLORS.STRATUS_BLUE}`,
    }}>
      <div style={{ fontWeight: 500, fontSize: 13, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
        {task.subject}
      </div>
      <div style={{ fontSize: 12, color: isOverdue ? COLORS.ERROR : COLORS.TEXT_SECONDARY, marginBottom: 4 }}>
        Due: {task.dueDate || 'No date'} {isOverdue ? '(Overdue)' : ''}
      </div>
      {task.dealName && (
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>
          Deal: {task.dealName}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <SmallButton onClick={onComplete} disabled={isLoading} color={COLORS.SUCCESS}>
          ✓ Complete + Follow-up
        </SmallButton>
        <SmallButton onClick={onClose} disabled={isLoading} color={COLORS.TEXT_SECONDARY}>
          Close Only
        </SmallButton>
        <SmallButton onClick={onReschedule} disabled={isLoading} color={COLORS.WARNING}>
          +3 Days
        </SmallButton>
      </div>
    </div>
  );
}

function SmallButton({ children, onClick, disabled, color }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 8px', background: `${color}15`, color,
        border: `1px solid ${color}33`, borderRadius: 4, fontSize: 11,
        fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added++;
  }
  return result.toISOString().split('T')[0];
}
