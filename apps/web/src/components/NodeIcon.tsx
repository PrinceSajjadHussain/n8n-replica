import {
  Webhook,
  Clock,
  GitBranch,
  Shuffle,
  Merge as MergeIcon,
  Hourglass,
  Repeat,
  RotateCw,
  Package,
  Reply,
  UserCheck,
  PenLine,
  Braces,
  Table,
  TableProperties,
  FileOutput,
  FileInput,
  Mail,
  Globe,
  Search,
  Bot,
  Brain,
  Share2,
  MonitorSmartphone,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';
import {
  siSlack,
  siDiscord,
  siTelegram,
  siNotion,
  siGithub,
  siPostgresql,
  siGooglesheets,
  siOpenai,
  siHubspot,
  siSalesforce,
  siZendesk,
  siIntercom,
  siMailchimp,
  siConvertio,
  siLinear,
  siJira,
  siAirtable,
  siDropbox,
  siStripe,
  siAsana,
  siTrello,
  siClickup,
  type SimpleIcon,
} from 'simple-icons';
import { getNodeTypeMeta } from '../lib/nodeTypeMeta';

/** Generic/logic glyphs, keyed by the `lucide:<Name>` half of `iconKey`. */
const LUCIDE_ICONS: Record<string, LucideIcon> = {
  Webhook,
  Clock,
  GitBranch,
  Shuffle,
  Merge: MergeIcon,
  Hourglass,
  Repeat,
  RotateCw,
  Package,
  Reply,
  UserCheck,
  PenLine,
  Braces,
  Table,
  TableProperties,
  FileOutput,
  FileInput,
  Mail,
  Globe,
  Search,
  Bot,
  Brain,
  Share2,
  MonitorSmartphone,
  Puzzle,
};

/** Branded service marks, keyed by the `si:<name>` half of `iconKey`. CC0 via `simple-icons`. */
const SIMPLE_ICONS: Record<string, SimpleIcon> = {
  siSlack,
  siDiscord,
  siTelegram,
  siNotion,
  siGithub,
  siPostgresql,
  siGooglesheets,
  siOpenai,
  siHubspot,
  siSalesforce,
  siZendesk,
  siIntercom,
  siMailchimp,
  siConvertio,
  siLinear,
  siJira,
  siAirtable,
  siDropbox,
  siStripe,
  siAsana,
  siTrello,
  siClickup,
};

/** Look up a brand icon by loose name matching — used by the Marketplace where
 *  package names ("hubspot-connector") don't line up 1:1 with node types. */
export function findBrandIconByName(name: string): SimpleIcon | undefined {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.values(SIMPLE_ICONS).find((icon) => icon.slug === normalized || normalized.includes(icon.slug));
}

export interface NodeIconProps {
  /** A NODE_TYPES `type` string (e.g. "slack"), OR an explicit iconKey ("si:siSlack" / "lucide:Bot"). */
  type: string;
  size?: number;
  className?: string;
  /** Override the resolved color (defaults to the brand hex for `si:` icons, or NodeTypeMeta.color otherwise). */
  color?: string;
}

/**
 * Single icon-rendering entry point for the whole app: canvas nodes, the node
 * picker sidebar, the Marketplace, and template gallery graph-previews all
 * render through this component so there is exactly one icon system, not a
 * bespoke one per surface. Resolves a real vector icon (branded via
 * `simple-icons`, generic via `lucide-react`) and only falls back to the
 * legacy emoji when neither is available, so a newly added / unmapped
 * community node type never crashes — it just looks a little plainer.
 */
export default function NodeIcon({ type, size = 20, className, color }: NodeIconProps) {
  const isExplicitKey = type.startsWith('si:') || type.startsWith('lucide:');
  const meta = isExplicitKey ? null : getNodeTypeMeta(type);
  const iconKey = isExplicitKey ? type : meta?.iconKey;

  if (iconKey?.startsWith('lucide:')) {
    const Cmp = LUCIDE_ICONS[iconKey.slice('lucide:'.length)];
    if (Cmp) {
      return <Cmp size={size} className={className} color={color ?? meta?.color} strokeWidth={2} />;
    }
  }

  if (iconKey?.startsWith('si:')) {
    const icon = SIMPLE_ICONS[iconKey.slice('si:'.length)];
    if (icon) {
      const fill = color ?? `#${icon.hex}`;
      return (
        <svg
          role="img"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          className={className}
          fill={fill}
          aria-label={icon.title}
        >
          <path d={icon.path} />
        </svg>
      );
    }
  }

  // Emoji fallback — always renders something, even for unmapped types.
  const fallbackEmoji = meta?.icon ?? '◆';
  return (
    <span className={className} style={{ fontSize: size * 0.72, lineHeight: 1 }}>
      {fallbackEmoji}
    </span>
  );
}
