
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { SubmittedFormData, FormSection } from '../types';
import { Users, BarChart3, Loader2 } from 'lucide-react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../src/lib/firebase';

interface AdminTeamOverviewPageProps {
  submittedForms?: SubmittedFormData[];
  formSections: FormSection[];
}

// Helper to find specific field IDs (case-insensitive label matching)
const findFieldIdByLabel = (labelToFind: string, formSections: FormSection[]): string | undefined => {
  const lowerLabel = labelToFind.toLowerCase();
  for (const section of formSections) {
    for (const field of section.fields) {
      if (field.label.toLowerCase() === lowerLabel) {
        return field.id;
      }
    }
  }
  return undefined;
};

const AdminTeamOverviewPage: React.FC<AdminTeamOverviewPageProps> = ({ submittedForms, formSections }) => {
  // BUG-A56-02: Read active employee headcount directly from master employees collection
  const [activeEmployees, setActiveEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchActive = async () => {
      try {
        const q = query(
          collection(db, 'employees'),
          where('isActive', '==', true),
          limit(1000)
        );
        const snap = await getDocs(q);
        if (!cancelled) {
          setActiveEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch (err) {
        console.warn("Failed to load active employees for team overview:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchActive();
    return () => { cancelled = true; };
  }, []);

  const totalApprovedEmployees = activeEmployees.length;

  const postFieldId = useMemo(() => findFieldIdByLabel("Post of Apply", formSections), [formSections]);
  const unitFieldId = useMemo(() => findFieldIdByLabel("Unit or Facility", formSections), [formSections]);
  const employmentHistoryFieldId = useMemo(() => findFieldIdByLabel("Previous Employment History", formSections), [formSections]);

  const aggregateData = useCallback(() => {
    const stats = {
      byPost: {} as Record<string, number>,
      byUnit: {} as Record<string, number>,
      byEmploymentHistory: {} as Record<string, number>,
    };

    activeEmployees.forEach(emp => {
      const data = emp.data || emp.formData || emp;
      if (postFieldId && data[postFieldId]) {
        const post = String(data[postFieldId]);
        stats.byPost[post] = (stats.byPost[post] || 0) + 1;
      }
      if (unitFieldId && data[unitFieldId]) {
        const unit = String(data[unitFieldId]);
        stats.byUnit[unit] = (stats.byUnit[unit] || 0) + 1;
      }
      if (employmentHistoryFieldId && data[employmentHistoryFieldId]) {
        const history = String(data[employmentHistoryFieldId]);
        stats.byEmploymentHistory[history] = (stats.byEmploymentHistory[history] || 0) + 1;
      }
    });
    return stats;
  }, [activeEmployees, postFieldId, unitFieldId, employmentHistoryFieldId]);

  const teamStats = useMemo(() => aggregateData(), [aggregateData]);

  const renderStatsCard = (title: string, data: Record<string, number>, icon: React.ReactNode) => {
    const entries = Object.entries(data);
    if (entries.length === 0) return null;

    return (
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <div className="flex items-center text-blue-600 mb-3">
          {icon}
          <h3 className="text-lg font-semibold ml-2">{title}</h3>
        </div>
        <ul className="space-y-1 text-sm text-gray-700 max-h-40 overflow-y-auto">
          {entries.sort(([,a],[,b]) => b-a).map(([key, value]) => (
            <li key={key} className="flex justify-between">
              <span>{key}:</span>
              <span className="font-medium">{value}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <div className="flex items-center text-indigo-600 mb-3">
            <Users size={28} className="mr-3" />
            <h2 className="text-2xl font-semibold">Team Snapshot</h2>
        </div>
        <p className="text-3xl font-bold text-gray-800">{totalApprovedEmployees}</p>
        <p className="text-sm text-gray-500">Total Approved Employees</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {renderStatsCard("Distribution by Post", teamStats.byPost, <BarChart3 size={20} />)}
        {renderStatsCard("Distribution by Unit/Facility", teamStats.byUnit, <BarChart3 size={20} />)}
        {renderStatsCard("Distribution by Employment History", teamStats.byEmploymentHistory, <BarChart3 size={20} />)}
      </div>
    </div>
  );
};

export default AdminTeamOverviewPage;

