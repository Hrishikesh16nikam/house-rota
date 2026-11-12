export type Status = 'pending' | 'done' | 'confirmed' | 'flagged' | 'missed' | 'skipped';

export interface Member {
  id: number;
  name: string;
  color: string;
  isAdmin: boolean;
  active: boolean;
  joined: boolean;
}

export interface Duty {
  id: number;
  name: string;
  icon: string;
  kind: 'weekly' | 'trash';
  slots: number;
  points: number;
  defaultPoints: number;
  eligible: number[] | null;
  active: boolean;
}

export interface Assignment {
  id: number;
  weekStart: string;
  dutyId: number;
  dutyName: string;
  icon: string;
  kind: 'weekly' | 'trash';
  slot: number;
  date: string | null;
  memberId: number | null;
  memberName: string | null;
  originalMemberId: number | null;
  originalMemberName: string | null;
  points: number;
  status: Status;
  doneAt: string | null;
  hasPhoto: boolean;
}

export interface Week {
  start: string;
  today: string;
  dates: string[];
  current: boolean;
  notes: string[];
  weekly: Assignment[];
  trash: Assignment[];
  free: number[];
}

export interface House {
  name: string;
  timezone: string;
  reminderHour: number;
  members: Member[];
  duties: Duty[];
}

export interface Swap {
  id: number;
  requester: { id: number; name: string };
  target: { id: number; name: string };
  assignment: Assignment;
  tradeFor: Assignment | null;
  createdAt: string;
}

export interface Fairness {
  memberId: number;
  name: string;
  color: string;
  earned: number;
  planned: number;
  done: number;
  missed: number;
  covered: number;
}

export interface HistoryEvent {
  id: number;
  ts: string;
  actor: string | null;
  type: string;
  what: string | null;
  icon: string | null;
  detail: Record<string, unknown>;
}

export interface Absence {
  id: number;
  memberId: number;
  memberName: string;
  startDate: string;
  endDate: string;
  note: string | null;
}

export interface VoteDuty extends Duty {
  myVote: number | null;
  votes: number;
}
