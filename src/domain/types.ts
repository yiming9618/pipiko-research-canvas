// Data model. Every stored entity carries `updated_at` and an optional
// `deleted` tombstone so two devices can be merged entry by entry.

export type ISODate = string // YYYY-MM-DD
export type ISODateTime = string

export interface Synced {
  id: string
  updated_at: ISODateTime
  deleted?: boolean
}

export type ImportKind = 'paper' | 'research'

/** One paste. `raw_md` is the original text and is never modified. */
export interface ImportEntry extends Synced {
  kind: ImportKind
  raw_md: string
  raw_hash: string
  /** When the content happened (decides where it sits on the timeline). */
  date: ISODate
  imported_at: ISODateTime
  notices: string[]
  message: string
  undone?: boolean
  paper_id?: string
  record_id?: string
  /** What this import changed on an existing paper, so undo can reverse it. */
  effects?: PaperImportEffects
  /** Research imports: "想看" entries created because the record named a DOI the library did not have. */
  wants_created?: string[]
  /** Research imports: existing AI-mentioned entries that gained this record as a source. */
  mentions_added?: string[]
}

export interface PaperImportEffects {
  paper_created: boolean
  /** Set when the paper was a "想看" entry before this import. */
  want_before?: { title: string; url: string }
  /** Paper fields that were empty and got filled by this import. */
  filled: PaperFillable[]
  keywords_added: string[]
  types_created: string[]
  /** A "想看" entry the person confirmed was this paper; kept whole so undo can bring it back. */
  merged_want?: Paper
}

export type PaperFillable =
  | 'title'
  | 'authors'
  | 'year'
  | 'venue'
  | 'doi'
  | 'category'
  | 'one_liner'
  | 'basics_md'

export interface Paper extends Synced {
  title: string
  authors: string[]
  year: number | null
  venue: string
  doi: string
  category: string
  keywords: string[]
  status: 'read' | 'want'
  /** Link for "想看" entries. */
  url: string
  one_liner: string
  /** The "基础" section as written. Empty string when not filled yet. */
  basics_md: string
  created_at: ISODateTime
  /** "为什么想看", one line, editable. Absent on entries from before this field existed. */
  why?: string
  /** Who put it in the library. Absent = 'me' (older entries, and papers that came in through a paper import). */
  added_by?: 'me' | 'ai'
  /** For entries the AI mentioned: the research records whose `papers:` list named this DOI. */
  mentioned_in?: { date: ISODate; record_id: string }[]
  /** Crossref lookup by DOI. Absent = never asked. 'pending' is retried when the device is online. */
  lookup?: 'pending' | 'done' | 'failed'
  /** Set once the person edits the entry's details by hand (matters for AI-mentioned entries on undo). */
  touched?: boolean
}

/** A highlight block (重点区块) or an unrecognised section of a paper. */
export interface PaperBlock extends Synced {
  paper_id: string
  /** null = a section the parser did not recognise; kept, shown as "其他". */
  type_id: string | null
  heading: string
  body_md: string
  /** Manual edit. The parsed original stays in `body_md`. */
  edited_md?: string
  /** Absent for blocks added by hand. */
  import_id?: string
  order: number
}

export interface HighlightType extends Synced {
  name: string
  /** Palette key, see ui/tokens.css. */
  color: string
  builtin: boolean
  /** Former names, so old Markdown still maps here after a rename. */
  aliases: string[]
  order: number
}

export type CommentSource = 'ai' | 'me' | 'drawing'

export interface Comment extends Synced {
  paper_id: string
  date: ISODate
  source: CommentSource
  text: string
  asset_id?: string
  import_id?: string
}

export interface ResearchRecord extends Synced {
  date: ISODate
  title: string
  summary: string
  activities: string[]
  keywords: string[]
  paper_dois: string[]
  /** Text that came before the first heading. Kept, never dropped. */
  preamble_md: string
  import_id: string
}

export const CARD_KINDS = ['发现', '实验', '问题', '思考', '下一步'] as const
export type CardKind = (typeof CARD_KINDS)[number] | '其他'

export interface Card extends Synced {
  record_id: string
  date: ISODate
  kind: CardKind
  /** Heading exactly as written (matters for kind '其他'). */
  heading: string
  body_md: string
  order: number
  import_id: string
}

/** Board ids: `day:2026-11-10` or `pile:<pile id>`. */
export type BoardRefType = 'cover' | 'card' | 'paper' | 'pile' | 'image' | 'text'

/** Only exists for things the user moved, resized, edited or added. */
export interface BoardItem extends Synced {
  board_id: string
  ref_type: BoardRefType
  /** Record id for 'cover', card/paper/pile id, asset id for 'image', '' for 'text'. */
  ref_id: string
  x: number
  y: number
  w: number
  h: number
  z: number
  /** Edited text for cards, or the content of a free text item. */
  text_override?: string
}

export interface Connector extends Synced {
  board_id: string
  /** BoardItem ids or ref keys like `card:<id>` for items still on the default layout. */
  from: string
  to: string
  arrow: boolean
}

export interface Stroke extends Synced {
  board_id: string
  /** Flat [x, y, pressure, x, y, pressure, ...] */
  points: number[]
  color: string
  size: number
}

export interface Pile extends Synced {
  name: string
  created_at: ISODateTime
}

/** A named list of things to talk over with the AI. A list, not a board: no positions. */
export interface Discussion extends Synced {
  name: string
  created_at: ISODateTime
  /** Set when put away after exporting. Archived boxes are hidden from the list but can be brought back. */
  archived_at?: ISODateTime
}

export type DiscussionRefType = 'paper' | 'card' | 'day' | 'pile'

/** One thing in a discussion box. Always a reference; the original is never copied. */
export interface DiscussionItem extends Synced {
  discussion_id: string
  ref_type: DiscussionRefType
  /** Paper id, card id, a date (YYYY-MM-DD) for a whole day's board, or pile id. */
  ref_id: string
  added_at: ISODateTime
}

export interface Setting extends Synced {
  value: string
}

export interface Asset extends Synced {
  mime: string
  w: number
  h: number
  /** Base64 payload. Stored locally and as a file in the data repo. */
  data: string
}

export interface Tables {
  imports: ImportEntry
  papers: Paper
  blocks: PaperBlock
  types: HighlightType
  comments: Comment
  records: ResearchRecord
  cards: Card
  boardItems: BoardItem
  connectors: Connector
  strokes: Stroke
  piles: Pile
  settings: Setting
  assets: Asset
  discussions: Discussion
  discussionItems: DiscussionItem
}

export type TableName = keyof Tables
export type Changes = { [K in TableName]?: Tables[K][] }

export const BUILTIN_TYPES: ReadonlyArray<{ id: string; name: string; color: string }> = [
  { id: 'type_contribution', name: '研究主旨/贡献', color: 'red' },
  { id: 'type_motivation', name: '研究动机 & RQ', color: 'pink' },
  { id: 'type_related', name: '相关研究', color: 'orange' },
  { id: 'type_method', name: '研究方法', color: 'green' },
  { id: 'type_system', name: '系统设计/实现', color: 'teal' },
  { id: 'type_result', name: '研究结果/发现', color: 'blue' },
  { id: 'type_discussion', name: '讨论 & 局限', color: 'gray' },
  { id: 'type_writing', name: '写作结构', color: 'purple' },
]

export const DEFAULT_TYPE_COLOR = 'default'
