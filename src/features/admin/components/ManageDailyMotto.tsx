import { showiOSAlert } from "../../../core/device/alert";
import React, { useState, useEffect } from "react";
import { apiClient } from "../../../core/api/apiClient";
import { useTranslation } from "../../../core/i18n/translations";
import { Trash2, Edit2, Plus, CheckCircle, XCircle } from "lucide-react";

interface Motto {
  id: string;
  message: string;
  isActive: boolean;
  createdAt: string;
}

export default function ManageDailyMotto({ language = "en" }: { language?: string }) {
  const { t } = useTranslation(language as any);
  const isRtl = language === "ar";
  const [mottos, setMottos] = useState<Motto[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");

  const fetchMottos = async () => {
    try {
      const res = await apiClient("/api/mottos");
      const data = await res.json();
      setMottos(data.mottos);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMottos();
    const handler = () => fetchMottos();
    window.addEventListener("socket-motto-updated", handler);
    return () => window.removeEventListener("socket-motto-updated", handler);
  }, []);

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(""), 3000);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiClient("/api/mottos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim(), isActive: true })
      });
      const data = await res.json();
      setMottos([data.motto, ...mottos]);
      setNewMessage("");
      showFeedback(isRtl ? "تم إضافة الشعار بنجاح" : "Motto added successfully");
    } catch {
      showFeedback(isRtl ? "فشل الإضافة" : "Failed to add motto");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    showiOSAlert({
      title: isRtl ? "هل أنت متأكد من الحذف؟" : "Are you sure you want to delete this?",
      actions: [
        { label: isRtl ? "إلغاء" : "Cancel", style: "cancel" },
        { 
          label: isRtl ? "حذف" : "Delete", 
          style: "destructive", 
          onClick: async () => {
            try {
              await apiClient(`/api/mottos/${id}`, { method: "DELETE" });
              setMottos((prev) => prev.filter((m) => m.id !== id));
              showFeedback(isRtl ? "تم الحذف بنجاح" : "Deleted successfully");
            } catch {
              showFeedback(isRtl ? "فشل الحذف" : "Failed to delete");
            }
          } 
        }
      ]
    });
  };

  const handleToggleActive = async (motto: Motto) => {
    try {
      const res = await apiClient(`/api/mottos/${motto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !motto.isActive })
      });
      const data = await res.json();
      setMottos(mottos.map((m) => (m.id === motto.id ? data.motto : m)));
      showFeedback(isRtl ? "تم تحديث الحالة" : "Status updated");
    } catch {
      showFeedback(isRtl ? "فشل التحديث" : "Failed to update status");
    }
  };

  const handleEditSubmit = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    if (!editMessage.trim()) return;
    try {
      const res = await apiClient(`/api/mottos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: editMessage.trim() })
      });
      const data = await res.json();
      setMottos(mottos.map((m) => (m.id === id ? data.motto : m)));
      setIsEditing(null);
      showFeedback(isRtl ? "تم التعديل بنجاح" : "Updated successfully");
    } catch {
      showFeedback(isRtl ? "فشل التعديل" : "Failed to update");
    }
  };

  if (loading) {
    return <div className="p-4">{isRtl ? "جاري التحميل..." : "Loading..."}</div>;
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6" style={{ direction: isRtl ? "rtl" : "ltr" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold dark:text-white">{isRtl ? "إدارة شعار اليوم" : "Manage Daily Mottos"}</h3>
      </div>

      {actionFeedback && (
        <div className="p-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg text-center dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
          {actionFeedback}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={isRtl ? "أضف شعاراً جديداً..." : "Add a new motto..."}
          className="flex-1 px-4 py-2 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 dark:text-white"
        />
        <button
          type="submit"
          className={`px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg flex items-center gap-2 font-medium transition ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={isSubmitting}
        >
          <Plus className="w-5 h-5" />
          {isRtl ? "إضافة" : "Add"}
        </button>
      </form>

      <div className="space-y-3">
        {mottos.length === 0 ? (
          <p className="text-neutral-500 dark:text-neutral-400 text-center py-4">{isRtl ? "لا توجد شعارات بعد." : "No mottos found."}</p>
        ) : (
          mottos.map((motto) => (
            <div key={motto.id} className="flex items-center justify-between p-4 bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm">
              <div className="flex-1">
                {isEditing === motto.id ? (
                  <form onSubmit={(e) => handleEditSubmit(e, motto.id)} className="flex gap-2 w-full pr-4">
                    <input
                      type="text"
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      className="flex-1 px-3 py-1 text-sm bg-neutral-100 dark:bg-neutral-800 border-none rounded focus:ring-2 focus:ring-rose-500 dark:text-white"
                      autoFocus
                    />
                    <button type="submit" className="text-rose-600 font-medium text-sm">{isRtl ? "حفظ" : "Save"}</button>
                    <button type="button" onClick={() => setIsEditing(null)} className="text-neutral-500 text-sm">{isRtl ? "إلغاء" : "Cancel"}</button>
                  </form>
                ) : (
                  <p className="text-neutral-800 dark:text-white font-medium">{motto.message}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${motto.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'}`}>
                    {motto.isActive ? (isRtl ? "نشط ويظهر للطلاب" : "Active (Visible)") : (isRtl ? "مخفي" : "Hidden")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggleActive(motto)}
                  title={isRtl ? "تغيير حالة الظهور" : "Toggle visibility"}
                  className={`p-2 rounded-lg transition ${motto.isActive ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                >
                  {motto.isActive ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(motto.id);
                    setEditMessage(motto.message);
                  }}
                  className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleDelete(motto.id)}
                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
