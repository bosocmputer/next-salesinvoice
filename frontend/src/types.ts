export type PageKey = "bulk" | "audit" | "status";

export type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T | null;
  error: { code: string; detail: string } | null;
};

export type DatabaseStatus = {
  connected: boolean;
  database: string;
  schema?: string;
  requiredSmlReady: boolean;
  appSchemaReady: boolean;
  missingSmlTables?: string[];
  missingAppTables?: string[];
};

export type UserClaims = {
  userCode: string;
  displayName: string;
  role: string;
};

export type DocumentSummary = {
  docNo: string;
  docDate: string;
  docTime: string;
  taxDocNo: string;
  taxDocDate: string;
  docRef: string;
  docRefDate: string;
  customerCode: string;
  contactor: string;
  inquiryType: number;
  vatType: number;
  saleCode: string;
  saleGroup: string;
  creditDay: string;
  creditDate: string;
  sendDay: string;
  sendDate: string;
  vatRate: string;
  totalValue: string;
  totalBeforeVat: string;
  totalAmount: string;
  totalVatValue: string;
  totalDiscount: string;
  totalAfterVat: string;
  totalExceptVat: string;
  remark: string;
  docFormatCode: string;
  appStatus: "pending" | "processing" | "done" | "failed" | "rolled_back" | string;
};

export type PagedDocuments = {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type DocFormat = {
  code: string;
  name: string;
  format: string;
};

export type Option = {
  code: string;
  name: string;
};

export type ProductOption = Option & {
  unitCode: string;
};

export type DocumentDetailLine = {
  lineNumber: number;
  itemCode: string;
  itemName: string;
  barcode: string;
  whCode: string;
  shelfCode: string;
  unitCode: string;
  qty: string;
  price: string;
  discount: string;
  sumAmount: string;
  totalVatValue: string;
};

export type RunningData = {
  formatCode: string;
  latestDocNo: string;
  nextDocNo: string;
};

export type DocumentChangePreview = {
  docNo: string;
  before: DocumentSummary;
  after: DocumentSummary;
  totals: {
    totalValue: string;
    totalVatValue: string;
    totalAmount: string;
    lineCount: number;
  };
  removedLines: DocumentDetailLine[];
  remainingLines: DocumentDetailLine[];
};

export type BulkDocumentChangeRequest = {
  docNos: string[];
  docFormatCode: string;
  customerCode: string;
  inquiryType: number;
  vatType: number;
  remark: string;
  removeItemCodes: string[];
};

export type BulkDocumentChangeItem = {
  docNo: string;
  newDocNo: string;
  status: "ready" | "warning" | "blocked" | "applied" | "failed" | "skipped";
  message: string;
  preview: DocumentChangePreview | null;
  removeHits: string[];
};

export type BulkDocumentChangeResult = {
  items: BulkDocumentChangeItem[];
  totalCount: number;
  readyCount: number;
  warningCount: number;
  blockedCount: number;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
};

export type PreviewChangeItem = {
  key: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
  tone?: "warning" | "danger";
};

export type BulkPreviewFilter = "all" | "writable" | "blocked";

export type AuditLogItem = {
  id: number;
  userCode: string;
  action: string;
  resourceId: string;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  createdAt: string;
};

export type DocumentRawState = {
  icTrans: Record<string, unknown>;
  icTransDetail: Array<Record<string, unknown>>;
};

export type DocumentHistoryItem = {
  snapshotId: number;
  batchId: number;
  originalDocNo: string;
  currentDocNo: string;
  createdBy: string;
  createdAt: string;
  rolledBackAt?: string;
  before: DocumentRawState;
  after: DocumentRawState;
  afterSummary?: Record<string, unknown>;
  status: string;
  message: string;
};

export type JsonDiffStatus = "changed" | "added" | "removed";
export type JsonDiffMap = Map<string, JsonDiffStatus>;
export type TechnicalJsonSection = {
  diff: JsonDiffMap;
  keyName: string;
  label: string;
  value: unknown;
};

export type AuditInvoiceDialogState = {
  doc: DocumentSummary;
  lines: DocumentDetailLine[];
  title: string;
  comparison?: {
    beforeDoc: DocumentSummary;
    beforeLines: DocumentDetailLine[];
  };
};

export type RollbackDocumentResult = {
  snapshotId: number;
  restored: DocumentSummary;
};

export type LineChangeState = {
  status: "same" | "changed" | "added";
  previous?: DocumentDetailLine;
  changedFields: Set<keyof DocumentDetailLine>;
};

export type ToastTone = "success" | "error" | "warning" | "info";
