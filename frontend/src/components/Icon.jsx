// Thin wrapper over lucide-react preserving CCM's <Icon name="sparkles" />
// prop surface. Maps kebab-case / CCM names to the corresponding
// lucide-react component export.
//
// Neon Studio retrofit adds `zap` (agent thinking header) and
// `arrow-right` (plan flow arrows) — required by SchedulerAgent and
// TrainTrackView. Rest of the set is unchanged from the original.
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  Ban,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Edit,
  ExternalLink,
  Filter,
  GitBranch,
  Inbox,
  Info,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  List,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  Sparkles,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";

const MAP = {
  "alert-triangle": AlertTriangle,
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "arrow-right": ArrowRight,
  ban: Ban,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  copy: Copy,
  edit: Edit,
  "external-link": ExternalLink,
  filter: Filter,
  "git-branch": GitBranch,
  inbox: Inbox,
  info: Info,
  "layout-dashboard": LayoutDashboard,
  "layout-grid": LayoutGrid,
  "link-2": Link2,
  list: List,
  lock: Lock,
  "log-out": LogOut,
  megaphone: Megaphone,
  "message-square": MessageSquare,
  "more-horizontal": MoreHorizontal,
  plus: Plus,
  radio: Radio,
  search: Search,
  sparkles: Sparkles,
  "trash-2": Trash2,
  user: User,
  x: X,
  zap: Zap,
};

export default function Icon({ name, size = 16, className = "", ...rest }) {
  const Cmp = MAP[name] || Info;
  return <Cmp size={size} className={className} aria-hidden="true" {...rest} />;
}
