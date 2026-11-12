export interface Member {
  id: number;
  name: string;
  active: boolean;
  trashOrder: number;
}

export interface Duty {
  id: number;
  name: string;
  kind: 'weekly' | 'trash';
  /** How many people do this duty each week (the kitchen has 2). */
  slots: number;
  /** Effort points, normally the house's average vote. */
  points: number;
  /** Members allowed to do it (a washroom's users), or null for everyone. */
  eligible: number[] | null;
}
