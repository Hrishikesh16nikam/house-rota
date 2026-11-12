import type { IconType } from 'react-icons';
import {
  TbBath, TbBrush, TbDog, TbPlant, TbRecycle, TbSofa, TbSparkles, TbToolsKitchen2, TbTrash, TbWashMachine,
} from 'react-icons/tb';

/** Icon keys stored on duties, mapped to Tabler line icons. */
export const DUTY_ICON_SET: Record<string, { icon: IconType; label: string }> = {
  bath: { icon: TbBath, label: 'Washroom' },
  kitchen: { icon: TbToolsKitchen2, label: 'Kitchen' },
  sofa: { icon: TbSofa, label: 'Living room' },
  trash: { icon: TbTrash, label: 'Trash' },
  laundry: { icon: TbWashMachine, label: 'Laundry' },
  plant: { icon: TbPlant, label: 'Plants or garden' },
  recycle: { icon: TbRecycle, label: 'Recycling' },
  brush: { icon: TbBrush, label: 'Cleaning' },
  dog: { icon: TbDog, label: 'Pet care' },
  sparkles: { icon: TbSparkles, label: 'Other' },
};

/** Picks the icon for a duty; older data stored emoji, so fall back on the name. */
export function dutyIcon(icon: string | undefined, name: string, kind: string): IconType {
  if (icon && DUTY_ICON_SET[icon]) return DUTY_ICON_SET[icon].icon;
  const n = name.toLowerCase();
  if (kind === 'trash' || n.includes('trash')) return TbTrash;
  if (n.includes('wash') || n.includes('bath')) return TbBath;
  if (n.includes('kitchen')) return TbToolsKitchen2;
  if (n.includes('living')) return TbSofa;
  if (n.includes('laundry')) return TbWashMachine;
  return TbSparkles;
}

export function DutyIcon({ icon, name, kind, size = 18 }: { icon?: string; name: string; kind: string; size?: number }) {
  const Icon = dutyIcon(icon, name, kind);
  return <Icon size={size} aria-hidden="true" />;
}
