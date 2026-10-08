import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';
import {
  AlignmentType,
  BorderStyle,
  BuilderElement,
  Document,
  Footer,
  Header,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  PageOrientation,
  Packer,
  Paragraph,
  StringContainer,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  UnderlineType,
  WidthType,
} from 'docx';
import { api } from '../services/api';
import { queryClient } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { useAuth } from '../contexts/AuthContext';
import SearchBox from '../components/SearchBox';

interface Column {
  key: string;
  label: string;
  render?: (val: unknown) => string;
}

type TabKey = 'it' | 'multimedia' | 'digital-media' | 'print-materials';
type ReportPrintFilter = 'range' | 'all' | 'daily' | 'weekly' | 'monthly' | 'calendar';
type ReportStatusScope = 'all' | 'done' | 'not-done';

interface TabConfig {
  key: TabKey;
  label: string;
}

interface PrintableColumn {
  key: string;
  label: string;
  render?: (val: unknown) => string;
}

interface PrintableRow {
  type: string;
  request_code: string;
  office?: string;
  client_name?: string;
  technician_name?: string;
  status?: string;
  created_at?: string;
  summary?: string;
  event_date?: string;
  event_start_time?: string;
  event_end_time?: string;
  specific_location?: string;
  form_of_digital_media?: string;
  event_ppa_name?: string;
  target_date?: string;
  requestor_name?: string;
  form_of_printed_media?: string;
  size_of_printed_media?: string;
  unit?: string;
  issue?: string;
  finished?: string;
  completed_at?: string;
}

const ALL_TABS: TabConfig[] = [
  { key: 'it', label: 'IT Requests' },
  { key: 'multimedia', label: 'Multimedia' },
  { key: 'digital-media', label: 'Digital Media' },
  { key: 'print-materials', label: 'Print Materials' },
];

const ROLE_TABS: Record<string, TabConfig[]> = {
  ADMIN: ALL_TABS,
  TECHNICIAN: [ALL_TABS[0]],
  IT_ADMIN: [ALL_TABS[0]],
  MULTIMEDIA: ALL_TABS.slice(1, 4),
  MULTIMEDIA_ADMIN: ALL_TABS.slice(1, 4),
};

const REPORT_TYPE_LABELS: Record<TabKey, string> = {
  it: 'IT Requests',
  multimedia: 'Multimedia',
  'digital-media': 'Digital Media',
  'print-materials': 'Print Materials',
};

const PRINT_TYPE_COLUMNS: Record<TabKey, PrintableColumn[]> = {
  it: [
    { key: 'request_code', label: 'Code' },
    { key: 'office', label: 'Office' },
    { key: 'unit', label: 'Unit' },
    { key: 'issue', label: 'Issue', render: truncateCell },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Finished', render: fmtDateTime },
  ],
  multimedia: [
    { key: 'request_code', label: 'Code' },
    { key: 'event_date', label: 'Event Date', render: fmt },
    { key: 'event_start_time', label: 'Start Time' },
    { key: 'event_end_time', label: 'End Time' },
    { key: 'specific_location', label: 'Specific Location' },
    { key: 'client_name', label: 'Client' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'digital-media': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_digital_media', label: 'Form of Media' },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'print-materials': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_printed_media', label: 'Form of Media' },
    { key: 'size_of_printed_media', label: 'Size' },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
};

function truncateLongWords(text: string): string {
  const MAX_LEN = 47;
  const ELLIPSIS = '...';
  if (text.length <= MAX_LEN) return text;
  const slice = text.slice(0, MAX_LEN - ELLIPSIS.length);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut + ELLIPSIS;
}

function truncateCell(v: unknown): string {
  const s = fmt(v);
  return s.length > 33 ? s.slice(0, 30) + '...' : s;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (v instanceof Date) {
    return v.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime()) && v.includes('T')) return d.toLocaleDateString();
    return v;
  }
  return String(v);
}

function fmtDateTime(v: unknown): string {
  if (!v) return '-';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface DarRow {
  date: string;
  type: string;
  detail: string;
}

interface DarMeta {
  filter: string;
  status: string;
  date: string;
  from?: string;
  to?: string;
  signatories: DarSignatories;
  // The user downloading the report, printed on the left signature line.
  preparedBy: string;
  // Their position from Profile / User Management, printed below the name.
  preparedByPosition: string;
}

// Set by an admin on the Signatories page; blank fields print as empty signature lines.
interface DarSignatories {
  supervisor_name: string;
  supervisor_position: string;
  mayor_name: string;
}

// Parse a YYYY-MM-DD input value as a local date (new Date('YYYY-MM-DD') would be UTC).
function parseLocalDay(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

const GRAY: [number, number, number] = [110, 110, 110];

// New / corrected constants to match the docx letterhead exactly
const HEADER_BLUE: [number, number, number] = [13, 43, 77];
const DIVIDER_GRAY: [number, number, number] = [150, 150, 150];
const GRAD_TOP: [number, number, number] = [255, 255, 255];
const GRAD_BOTTOM: [number, number, number] = [188, 224, 244];

const DAR_ADDRESS = 'National Highway, Barangay Roxas, Solano, Nueva Vizcaya, 3709';
const DAR_UNIT =
  'SYSTEM, NETWORK AND DATABASE MANAGEMENT UNIT AND EQUIPMENT OPERATIONS AND HARDWARE MAINTENANCE UNIT';
const DAR_ISO = 'Certificate No. PHP QMS 25 93 0342';
const DAR_NOTE =
  'Note: This requirement on accomplishment report will be submitted attached to Daily Time Record (DTR) every payday to complete the claims of Job Order for wages to ensure that payment to them is commensurate to the service they rendered. (As per COA Audit Observation Memorandum dated February 14, 2017)';

function fmtLongDate(d: Date): string {
  return d
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

function computePeriod(filter: string, date: string, rows: DarRow[], from?: string, to?: string): string {
  if (filter === 'range' && from && to) {
    const s = fmtLongDate(parseLocalDay(from));
    const e = fmtLongDate(parseLocalDay(to));
    return s === e ? s : `${s} TO ${e}`;
  }
  const d = date ? new Date(date) : new Date();
  if (filter === 'daily' || filter === 'calendar') {
    return isNaN(d.getTime()) ? fmtLongDate(new Date()) : fmtLongDate(d);
  }
  if (filter === 'weekly') {
    const start = new Date(d);
    start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${fmtLongDate(start)} TO ${fmtLongDate(end)}`;
  }
  if (filter === 'monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return `${fmtLongDate(start)} TO ${fmtLongDate(end)}`;
  }
  let min = Infinity;
  let max = -Infinity;
  rows.forEach((r) => {
    if (r.date === '-') return;
    const t = new Date(r.date).getTime();
    if (!isNaN(t)) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
  });
  if (isFinite(min) && isFinite(max)) {
    const s = fmtLongDate(new Date(min));
    const e = fmtLongDate(new Date(max));
    return s === e ? s : `${s} TO ${e}`;
  }
  return fmtLongDate(d);
}

function listPeriodDays(filter: string, date: string, rows: DarRow[], from?: string, to?: string): Date[] {
  if (filter === 'range' && from && to) {
    const days: Date[] = [];
    const cursor = parseLocalDay(from);
    const end = parseLocalDay(to);
    while (cursor.getTime() <= end.getTime()) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }
  const d = date ? new Date(date) : new Date();
  const safeDay = isNaN(d.getTime()) ? new Date() : d;
  if (filter === 'daily' || filter === 'calendar') return [safeDay];
  if (filter === 'weekly') {
    const start = new Date(safeDay);
    start.setDate(safeDay.getDate() - ((safeDay.getDay() + 6) % 7));
    const days: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }
    return days;
  }
  if (filter === 'monthly') {
    const lastDay = new Date(safeDay.getFullYear(), safeDay.getMonth() + 1, 0).getDate();
    const days: Date[] = [];
    for (let i = 1; i <= lastDay; i += 1) {
      days.push(new Date(safeDay.getFullYear(), safeDay.getMonth(), i));
    }
    return days;
  }
  let min = Infinity;
  let max = -Infinity;
  rows.forEach((r) => {
    if (r.date === '-') return;
    const t = new Date(r.date).getTime();
    if (!isNaN(t)) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
  });
  if (isFinite(min) && isFinite(max)) {
    const days: Date[] = [];
    const cursor = new Date(min);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= max) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }
  return [safeDay];
}

function loadImageDataUrl(url: string): Promise<string | null> {
  return fetch(url)
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('fetch failed'))))
    .then(
      (blob) =>
        new Promise<string | null>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(blob);
        })
    )
    .catch(() => null);
}

interface DarImages {
  seal: string | null;
  logo1: string | null;
  logo2: string | null;
  logo3: string | null;
  footerLogo: string | null;
  footerGradient: string | null;
}

const GDL_CLUSTER =
  'GOVERNANCE INNOVATION, DIGITAL TRANSFORMATION and LEGAL AFFAIRS (GDL) CLUSTER';

const mmToDxa = (mm: number): number => Math.round((mm / 25.4) * 1440);
const mmToPx = (mm: number): number => Math.round((mm / 25.4) * 96);
const mmToEmu = (mm: number): number => Math.round(mm * 36000);

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type DarFont = 'Times New Roman' | 'Arial' | 'Bookman Old Style' | 'Balthazar';

interface TrOpts {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  font?: DarFont;
  charSpace?: number;
  underline?: boolean;
}

function tr(text: string, halfPoints: number, opts: TrOpts = {}): TextRun {
  return new TextRun({
    text,
    font: opts.font ?? 'Times New Roman',
    size: halfPoints,
    bold: opts.bold ?? false,
    italics: opts.italic ?? false,
    color: opts.color ?? '000000',
    ...(opts.underline ? { underline: { type: UnderlineType.SINGLE } } : {}),
    ...(opts.charSpace ? { characterSpacing: opts.charSpace } : {}),
  });
}

function fieldChar(type: 'begin' | 'separate' | 'end'): BuilderElement<{ type: string }> {
  return new BuilderElement({ name: 'w:fldChar', attributes: { type: { key: 'w:fldCharType', value: type } } });
}

// PAGE/NUMPAGES via a bare `children: [PageNumber.CURRENT]` run leaves the field with no
// cached result, so viewers that don't recalculate fields with the run's own styling
// (e.g. LibreOffice) render the page number in a default font/size instead of ours.
// Building begin/instrText/separate/<styled cached value>/end as their own runs keeps a
// styled result in place until Word (or anything else) recalculates it.
function styledPageField(instr: 'PAGE' | 'NUMPAGES', cachedText: string, opts: TrOpts & { size: number }): TextRun[] {
  const rPr = { font: opts.font, size: opts.size, bold: opts.bold, color: opts.color };
  return [
    new TextRun({ ...rPr, children: [fieldChar('begin')] }),
    new TextRun({ ...rPr, children: [new StringContainer('w:instrText', instr)] }),
    new TextRun({ ...rPr, children: [fieldChar('separate')] }),
    new TextRun({ ...rPr, text: cachedText }),
    new TextRun({ ...rPr, children: [fieldChar('end')] }),
  ];
}

function darImage(dataUrl: string | null, wMm: number, hMm: number): ImageRun[] {
  if (!dataUrl) return [];
  return [
    new ImageRun({
      type: 'png',
      data: dataUrlToBytes(dataUrl),
      transformation: { width: mmToPx(wMm), height: mmToPx(hMm) },
    }),
  ];
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noCellBorders = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const noTableBorders = {
  ...noCellBorders,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};
const GRID_LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const gridBorders = {
  top: GRID_LINE,
  bottom: GRID_LINE,
  left: GRID_LINE,
  right: GRID_LINE,
  insideHorizontal: GRID_LINE,
  insideVertical: GRID_LINE,
};

const DAR_BLUE_HEX = '1F4E79';
const PAGE_BLUE_HEX = '9CC3E5';

function buildDarHeader(imgs: DarImages, period: string): Header {
  const sealImg = darImage(imgs.seal, 18, 18);
  // Asset identity (empirically confirmed from rendered output):
  // imgs.logo1 = Bagong Pilipinas, imgs.logo2 = SGLG, imgs.logo3 = ISO 9001.
  const bagongPilipinas = darImage(imgs.logo1, 16.3, 17);
  const isoBadge = darImage(imgs.logo3, 18.3, 17);
  const sglgSeal = darImage(imgs.logo2, 20.7, 17);

  const headerTable = new Table({
    width: { size: 15398, type: WidthType.DXA },
    columnWidths: [1191, 4300, 5900, 4007],
    layout: TableLayoutType.FIXED,
    borders: noTableBorders,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1191, type: WidthType.DXA },
            borders: noCellBorders,
            verticalAlign: VerticalAlign.CENTER,
            children:
              sealImg.length > 0
                ? [new Paragraph({ children: sealImg })]
                : [new Paragraph({ children: [] })],
          }),
          new TableCell({
            width: { size: 4300, type: WidthType.DXA },
            borders: noCellBorders,
            verticalAlign: VerticalAlign.CENTER,
            margins: { left: 100 },
            children: [
              new Paragraph({ spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [tr('Republic of the Philippines', 17, { font: 'Bookman Old Style' })] }),
              new Paragraph({ spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [tr('Province of Nueva Vizcaya', 17, { font: 'Bookman Old Style' })] }),
              new Paragraph({ spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [tr('MUNICIPALITY OF SOLANO', 22, { bold: true, font: 'Bookman Old Style' })] }),
              new Paragraph({ spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [tr(DAR_ADDRESS, 13, { font: 'Bookman Old Style' })] }),
            ],
          }),
          new TableCell({
            width: { size: 5900, type: WidthType.DXA },
            borders: noCellBorders,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
                children: [tr('OFFICE OF THE MUNICIPAL MAYOR', 32, { bold: true, color: DAR_BLUE_HEX, font: 'Balthazar' })],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
                children: [tr(GDL_CLUSTER, 10, { bold: true, color: DAR_BLUE_HEX, font: 'Bookman Old Style' })],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
                children: [tr(DAR_UNIT, 18, { font: 'Bookman Old Style' })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 4007, type: WidthType.DXA },
            borders: noCellBorders,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [
              new Table({
                width: { size: 3798, type: WidthType.DXA },
                columnWidths: [1230, 1320, 1248],
                layout: TableLayoutType.FIXED,
                borders: noTableBorders,
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: 1230, type: WidthType.DXA },
                        borders: noCellBorders,
                        verticalAlign: VerticalAlign.BOTTOM,
                        children:
                          bagongPilipinas.length > 0
                            ? [new Paragraph({ alignment: AlignmentType.CENTER, children: bagongPilipinas })]
                            : [new Paragraph({ children: [] })],
                      }),
                      new TableCell({
                        width: { size: 1320, type: WidthType.DXA },
                        borders: noCellBorders,
                        verticalAlign: VerticalAlign.BOTTOM,
                        children:
                          isoBadge.length > 0
                            ? [
                                new Paragraph({ alignment: AlignmentType.CENTER, children: isoBadge }),
                                ...(imgs.logo3
                                  ? [
                                      new Paragraph({
                                        alignment: AlignmentType.CENTER,
                                        spacing: { before: 20 },
                                        children: [tr(DAR_ISO, 8, { bold: true })],
                                      }),
                                    ]
                                  : []),
                              ]
                            : [new Paragraph({ children: [] })],
                      }),
                      new TableCell({
                        width: { size: 1248, type: WidthType.DXA },
                        borders: noCellBorders,
                        verticalAlign: VerticalAlign.BOTTOM,
                        children:
                          sglgSeal.length > 0
                            ? [new Paragraph({ alignment: AlignmentType.CENTER, children: sglgSeal })]
                            : [new Paragraph({ children: [] })],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return new Header({
    children: [
      headerTable,
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } },
        spacing: { before: 80, after: 200 },
        children: [],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          tr(`DAILY ACCOMPLISHMENT REPORT FOR THE PERIOD ${period}`, 22, {
            bold: true,
            font: 'Bookman Old Style',
          }),
        ],
      }),
    ],
  });
}

function contactPara(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [tr(label, 14, { bold: true, font: 'Arial' }), tr(value, 14, { font: 'Arial' })],
  });
}

function footerCell(opts: {
  width: number;
  columnSpan?: number;
  marginLeft?: number;
  marginRight?: number;
  children: Paragraph[];
}): TableCell {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    borders: noCellBorders,
    columnSpan: opts.columnSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins:
      opts.marginLeft || opts.marginRight
        ? { left: opts.marginLeft, right: opts.marginRight }
        : undefined,
    children: opts.children,
  });
}

function buildDarFooter(imgs: DarImages): Footer {
  const footerLogoImg = darImage(imgs.footerLogo, 25.1, 7.6);
  // Page is landscape 16838x11906 dxa (see page.size below); pin the band to the
  // full page width and to the bottom edge so it renders consistently across viewers.
  const gradientWidthMm = (16838 / 1440) * 25.4;
  const gradientHeightMm = 62.1;
  const gradientTopMm = (11906 / 1440) * 25.4 - gradientHeightMm;
  const gradientImg = imgs.footerGradient
    ? [
        new ImageRun({
          type: 'png',
          data: dataUrlToBytes(imgs.footerGradient),
          transformation: { width: mmToPx(gradientWidthMm), height: mmToPx(gradientHeightMm) },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: mmToEmu(gradientTopMm) },
            behindDocument: true,
            allowOverlap: true,
          },
        }),
      ]
    : [];

  return new Footer({
    children: [
      new Paragraph({ children: gradientImg }),
      new Table({
        width: { size: 16838, type: WidthType.DXA },
        columnWidths: [1696, 2694, 3260, 7445, 1743],
        layout: TableLayoutType.FIXED,
        indent: { size: -720, type: WidthType.DXA },
        borders: noTableBorders,
        rows: [
          new TableRow({
            height: { value: 466, rule: HeightRule.EXACT },
            children: [
              footerCell({
                width: 1696,
                marginLeft: 300,
                children:
                  footerLogoImg.length > 0
                    ? [new Paragraph({ children: footerLogoImg })]
                    : [new Paragraph({ children: [] })],
              }),
              footerCell({
                width: 2694,
                marginLeft: 250,
                children: [
                  contactPara('Mobile Number', ': 0917-595-1931'),
                  contactPara('Telephone Number', ': (078) 321-2440'),
                ],
              }),
              footerCell({
                width: 3260,
                children: [
                  contactPara('Email Address', ': lgusolanonv@gmail.com'),
                  contactPara('Website', ': solano.gov.ph'),
                ],
              }),
              footerCell({
                width: 7445,
                children: [
                  contactPara('LGU Facebook Page:', ' Facebook.com/OfficialLguSolanoFanpage'),
                  contactPara('Office Facebook Page:', ' facebook.com/LguSolanoOfficialPage'),
                ],
              }),
              footerCell({
                width: 1743,
                marginRight: 300,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      tr('Page ', 16, { bold: true, font: 'Arial', color: PAGE_BLUE_HEX }),
                      ...styledPageField('PAGE', '1', { font: 'Arial', size: 16, bold: true, color: PAGE_BLUE_HEX }),
                      tr(' of ', 16, { bold: true, font: 'Arial', color: PAGE_BLUE_HEX }),
                      ...styledPageField('NUMPAGES', '1', { font: 'Arial', size: 16, bold: true, color: PAGE_BLUE_HEX }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { line: 400, lineRule: LineRuleType.EXACT }, children: [] }),
    ],
  });
}

async function buildDesignedDocx(rows: DarRow[], meta: DarMeta): Promise<Blob> {
  const imgs: DarImages = {
    seal: await loadImageDataUrl('/dar-hdr-seal.png'),
    logo1: await loadImageDataUrl('/dar-hdr-logo1.png'),
    logo2: await loadImageDataUrl('/dar-hdr-logo2.png'),
    logo3: await loadImageDataUrl('/dar-hdr-logo3.png'),
    footerLogo: await loadImageDataUrl('/dar-footer-logo.png'),
    footerGradient: await loadImageDataUrl('/dar-footer-gradient.png'),
  };
  const period = computePeriod(meta.filter, meta.date, rows, meta.from, meta.to);
  const days = listPeriodDays(meta.filter, meta.date, rows, meta.from, meta.to);

  const entriesByDay = new Map<string, string[]>();
  rows.forEach((row) => {
    if (row.date === '-') return;
    const d = new Date(row.date);
    if (isNaN(d.getTime())) return;
    const key = d.toDateString();
    const list = entriesByDay.get(key) ?? [];
    list.push(`${row.type || '-'}: ${truncateLongWords(row.detail || '-')}`);
    entriesByDay.set(key, list);
  });

  const gridCellBorders = {
    top: GRID_LINE,
    bottom: GRID_LINE,
    left: GRID_LINE,
    right: GRID_LINE,
  };

  const dateCell = (text: string): TableCell =>
    new TableCell({
      width: { size: 2772, type: WidthType.DXA },
      borders: gridCellBorders,
      children: [new Paragraph({ children: [tr(text, 20, { bold: true })] })],
    });

  const entryCell = (entries: string[]): TableCell =>
    new TableCell({
      width: { size: 12626, type: WidthType.DXA },
      borders: gridCellBorders,
      children:
        entries.length > 0
          ? entries.map(
              (entry) => new Paragraph({ spacing: { after: 40 }, children: [tr(entry, 20)] }),
            )
          : [new Paragraph({ children: [] })],
    });

  const bodyTable = new Table({
    width: { size: 15398, type: WidthType.DXA },
    columnWidths: [2772, 12626],
    layout: TableLayoutType.FIXED,
    borders: gridBorders,
    margins: { top: 100, bottom: 100, left: 170, right: 170 },
    rows: entriesByDay.size === 0
      ? [new TableRow({
          children: [
            dateCell(fmt(days[0] ?? new Date())),
            entryCell(['No accomplishments recorded for this period.']),
          ],
        })]
      : days
          .filter((day) => entriesByDay.has(day.toDateString()))
          .map((day) => {
            const entries = entriesByDay.get(day.toDateString()) ?? [];
            return new TableRow({
              children: [dateCell(fmt(day)), entryCell(entries)],
            });
          }),
  });

  const notePara = new Paragraph({
    spacing: { before: 300 },
    children: [tr(DAR_NOTE, 18)],
  });

  // Signature names and labels print at 12pt (24 half-points).
  const SIG_SIZE = 24;
  const sigNameLine = '_______________________';
  const sigDesignationLine = '_________________';
  const { supervisor_name, supervisor_position, mayor_name } = meta.signatories;
  const sigSlot = (name = '', designation = ''): TableCell =>
    new TableCell({
      width: { size: 7699, type: WidthType.DXA },
      borders: noCellBorders,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 500 },
          children: [name ? tr(name.toUpperCase(), SIG_SIZE, { bold: true, underline: true }) : tr(sigNameLine, SIG_SIZE, { bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: name ? 0 : 200 }, children: [tr(designation || sigDesignationLine, SIG_SIZE)] }),
      ],
    });

  const sigTable = new Table({
    width: { size: 15398, type: WidthType.DXA },
    columnWidths: [7699, 7699],
    layout: TableLayoutType.FIXED,
    borders: noTableBorders,
    rows: [
      new TableRow({
        children: [sigSlot(meta.preparedBy, meta.preparedByPosition), sigSlot(supervisor_name, supervisor_position)],
      }),
    ],
  });

  const mayorSigParas = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [mayor_name
        ? tr(mayor_name.toUpperCase(), SIG_SIZE, { bold: true, underline: true })
        : tr('__________________________', SIG_SIZE, { bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [tr('Municipal Mayor', SIG_SIZE)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300 },
      children: [tr(fmt(new Date()), SIG_SIZE, { bold: true, italic: true, underline: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [tr('Date', SIG_SIZE, { italic: true })],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
            margin: { top: 280, right: 720, bottom: 2300, left: 720, header: 900, footer: 0 },
          },
        },
        headers: { default: buildDarHeader(imgs, period) },
        footers: { default: buildDarFooter(imgs) },
        children: [bodyTable, notePara, sigTable, ...mayorSigParas],
      },
    ],
  });

  return Packer.toBlob(doc);
}
function renderPrintableCell(row: PrintableRow, col: PrintableColumn): string {
  const raw = row[col.key as keyof PrintableRow];
  if (col.render) return col.render(raw);
  if (raw === undefined || raw === null || raw === '') return '-';
  return String(raw);
}

const COLUMNS: Record<TabKey, Column[]> = {
  'it': [
    { key: 'request_code', label: 'Code' },
    { key: 'office', label: 'Office' },
    { key: 'unit', label: 'Unit' },
    { key: 'issue', label: 'Issue' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'finished', label: 'Finished' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'recommendation', label: 'Recommendation' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'multimedia': [
    { key: 'request_code', label: 'Code' },
    { key: 'event_title', label: 'Event Title', render: truncateCell },
    { key: 'event_date', label: 'Event Date', render: fmt },
    { key: 'event_start_time', label: 'Start Time' },
    { key: 'event_end_time', label: 'End Time' },
    { key: 'location_type', label: 'Location Type' },
    { key: 'specific_location', label: 'Specific Location' },
    { key: 'contact_number', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'digital-media': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_digital_media', label: 'Form of Media', render: truncateCell },
    { key: 'digital_media_description', label: 'Description', render: truncateCell },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'target_time', label: 'Target Time' },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'requestor_contact', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'print-materials': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_printed_media', label: 'Form of Media', render: truncateCell },
    { key: 'size_of_printed_media', label: 'Size' },
    { key: 'printed_media_description', label: 'Description', render: truncateCell },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'target_time', label: 'Target Time' },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'requestor_contact', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
};

function Reports() {
  const { user } = useAuth();
  const userRoles = user?.roles || [user?.role || 'ADMIN'];
  const tabs = (() => {
    const seen = new Set<string>();
    return ALL_TABS.filter(t => {
      if (seen.has(t.key)) return false;
      const hasAccess = userRoles.some(r => {
        const roleTabs = ROLE_TABS[r];
        return roleTabs && roleTabs.some(rt => rt.key === t.key);
      });
      if (hasAccess) {
        seen.add(t.key);
        return true;
      }
      return false;
    });
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]?.key || 'it');
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [showDone, setShowDone] = useState('1');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printFilterType, setPrintFilterType] = useState<ReportPrintFilter>('range');
  const [printDate, setPrintDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [printFrom, setPrintFrom] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
  });
  const [printTo, setPrintTo] = useState(new Date().toLocaleDateString('en-CA'));
  const printRangeInvalid = printFilterType === 'range' && (!printFrom || !printTo || printFrom > printTo);
  const [printStatusScope, setPrintStatusScope] = useState<ReportStatusScope>('all');
  const [printLoading, setPrintLoading] = useState(false);

  const columns = COLUMNS[activeTab];

  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm, activeTab]);

  const ITEMS_PER_PAGE = 10;

  // Cached per tab, filter and page. Request changes in any service refresh it, batched per
  // burst (['overview'] in services/queryClient.ts).
  const params = { type: activeTab, filter: filterType, date: selectedDate, show_done: showDone, page: currentPage, limit: ITEMS_PER_PAGE, ...(searchTerm && { search: searchTerm }) };
  const { data, isPending: loading } = useQuery({
    queryKey: ['overview', 'reports', params],
    queryFn: () => api.get<{ reports: Record<string, unknown>[]; total?: number }>('/reports/get_reports', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or filter loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const reports = data?.reports ?? [];
  const total = data?.total || 0;

  const exportToExcel = () => {
    const params = new URLSearchParams({ type: activeTab, filter: filterType, date: selectedDate, show_done: showDone });
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    window.location.href = `/api/reports/export_excel?${params}`;
  };

  const downloadCombinedReport = async () => {
    try {
      setPrintLoading(true);
      const isRange = printFilterType === 'range';
      const activeFilter =
        printFilterType === 'calendar' ? 'daily' : isRange ? 'all' : printFilterType;
      const effectiveDate =
        printFilterType === 'all' ? new Date().toLocaleDateString('en-CA') : isRange ? printFrom : printDate;
      const paramsBase = {
        filter: activeFilter,
        date: effectiveDate,
        show_done: '1',
      };

      // The server returns at most 100 rows per page, so read every page; otherwise a report
      // covering more than 100 requests of one type would silently leave the rest out.
      const PAGE_LIMIT = 100;
      const fetchAllReports = async (typeKey: TabKey) => {
        const all: Record<string, unknown>[] = [];
        for (let page = 1; ; page++) {
          const response = await api.get('/reports/get_reports', {
            params: { ...paramsBase, type: typeKey, page, limit: PAGE_LIMIT },
          });
          all.push(...((response.data.reports || []) as Record<string, unknown>[]));
          if (page >= (response.data.totalPages || 0)) return all;
        }
      };

      const printableTypes = tabs.map(tab => tab.key) as TabKey[];
      const responses = await Promise.all(printableTypes.map(fetchAllReports));

      const groupedByType: Record<string, DarRow[]> = {};

      printableTypes.forEach((typeKey) => {
        groupedByType[typeKey] = [];
      });

      printableTypes.forEach((typeKey, idx) => {
        const rows = responses[idx] || [];

        rows.forEach((row) => {
          const status = String(row.status || '');
          // A declined request was never worked on, so it is neither an accomplishment nor outstanding work.
          if (status === 'DECLINED') return;
          const matchesStatus =
            printStatusScope === 'all'
              ? true
              : printStatusScope === 'done'
                ? status === 'DONE'
                : status !== 'DONE';

          if (!matchesStatus) return;

          const dateValue = (() => {
            if (typeKey === 'multimedia') return String(row.event_date || row.created_at || row.completed_at || '-');
            if (typeKey === 'digital-media') return String(row.target_date || row.event_date || row.created_at || row.completed_at || '-');
            if (typeKey === 'print-materials') return String(row.target_date || row.event_date || row.created_at || row.completed_at || '-');
            return String(row.created_at || row.completed_at || '-');
          })();

          if (isRange) {
            const parsed = new Date(dateValue);
            if (Number.isNaN(parsed.getTime())) return;
            const day = parsed.toLocaleDateString('en-CA');
            if (day < printFrom || day > printTo) return;
          }

          const detailValue = (() => {
            if (typeKey === 'it') return String(row.issue || '-');
            if (typeKey === 'multimedia') return String(row.event_title || '-');
            if (typeKey === 'digital-media') return String(row.digital_media_description || row.description || '-');
            if (typeKey === 'print-materials') return String(row.form_of_printed_media || row.printed_media_description || '-');
            return '-';
          })();

          groupedByType[typeKey].push({ date: dateValue, type: REPORT_TYPE_LABELS[typeKey], detail: detailValue });
        });
      });

      const rows: DarRow[] = printableTypes.flatMap((typeKey) => groupedByType[typeKey]);
      rows.sort((a, b) => {
        const aTime = a.date === '-' ? Infinity : new Date(a.date).getTime();
        const bTime = b.date === '-' ? Infinity : new Date(b.date).getTime();
        return (Number.isNaN(aTime) ? Infinity : aTime) - (Number.isNaN(bTime) ? Infinity : bTime);
      });

      // Shared with the Signatories page, so names saved there are used without another request.
      const signatories = await queryClient
        .fetchQuery({ queryKey: ['meta', 'signatories'], queryFn: () => api.get<DarSignatories>('/signatories').then((res) => res.data) })
        .catch(() => ({ supervisor_name: '', supervisor_position: '', mayor_name: '' }));

      const middleInitial = user?.middle_name?.trim() ? ` ${user.middle_name.trim().charAt(0)}.` : '';
      const preparedBy = user ? `${user.first_name.trim()}${middleInitial} ${user.last_name.trim()}`.trim() : '';

      const docxBlob = await buildDesignedDocx(rows, {
        signatories,
        preparedBy,
        preparedByPosition: user?.position?.trim() || '',
        filter: printFilterType,
        status: printStatusScope,
        date: effectiveDate,
        ...(isRange ? { from: printFrom, to: printTo } : {}),
      });

      const objectUrl = URL.createObjectURL(docxBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      const normalizedDate = isRange ? `${printFrom}_to_${printTo}` : effectiveDate.replace(/\//g, '-');
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      downloadLink.download = `DAR-${normalizedDate}-${stamp}.docx`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(objectUrl);

      setPrintLoading(false);
    } catch (error) {
      console.error('Failed to generate combined DOCX report:', error);
      setPrintLoading(false);
    }
  };

  const renderStatus = (status: unknown) => {
    const s = String(status || '');
    const cls = s === 'DONE' ? 'done' : s === 'CANCELLED' ? 'cancelled' : s === 'DECLINED' ? 'declined' : 'pending';
    return (
      <span className={`hstatus ${cls}`}>
        <span className={`hstatus-dot ${cls}`} />
        {s || '-'}
      </span>
    );
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Reports</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => setShowPrintModal(true)} className="btn-export btn-export-alt">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Download DOCX
          </button>
          <button onClick={exportToExcel} className="btn-export">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </div>

      <div className="reports-toolbar">
        <div className="reports-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`reports-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {activeTab === tab.key && (
                <motion.span
                  layoutId="reports-tab-indicator"
                  className="reports-tab-indicator"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          ))}
        </div>

        <div className="filters-row">
          <SearchBox placeholder="Search by code, description, name..." value={searchTerm} onSearch={setSearchTerm} />

          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />

          <label>
            <input type="checkbox" checked={showDone === '1'} onChange={(e) => setShowDone(e.target.checked ? '1' : '0')} />
            <span>Show Done</span>
          </label>
        </div>
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : reports.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#128202;</div>
          <h3>No reports found</h3>
          <p>Try adjusting your search or date filters.</p>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report, idx) => (
                <motion.tr
                  key={report.request_code as string || idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, delay: Math.min(idx, 8) * 0.03, ease: EASE_OUT }}
                >
                  {columns.map(col => (
                    <td key={col.key} className={col.key === 'request_code' ? 'td-code' : 'td-cell'} data-label={col.label}>
                      {col.key === 'status' ? renderStatus(report[col.key]) : col.render ? col.render(report[col.key]) : fmt(report[col.key])}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPrintModal && (
        <div className="modal">
          <div className="modal-content" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>Print combined PDF report</h3>
              <button type="button" className="modal-close" onClick={() => setShowPrintModal(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Filter range</label>
                <select value={printFilterType} onChange={(e) => setPrintFilterType(e.target.value as ReportPrintFilter)}>
                  <option value="range">Date range (From – To)</option>
                  <option value="all">All</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="calendar">Calendar</option>
                </select>
              </div>

              {printFilterType === 'range' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 180px' }}>
                    <label>From</label>
                    <input type="date" value={printFrom} max={printTo || undefined} onChange={(e) => setPrintFrom(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 180px' }}>
                    <label>To</label>
                    <input type="date" value={printTo} min={printFrom || undefined} onChange={(e) => setPrintTo(e.target.value)} />
                  </div>
                  {printRangeInvalid && (
                    <p style={{ color: '#dc2626', fontSize: 13, margin: 0, width: '100%' }}>
                      Pick a From date that is on or before the To date.
                    </p>
                  )}
                </div>
              )}

              {printFilterType !== 'all' && printFilterType !== 'range' && (
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={printDate} onChange={(e) => setPrintDate(e.target.value)} />
                </div>
              )}

              <div className="form-group">
                <label>Status</label>
                <select value={printStatusScope} onChange={(e) => setPrintStatusScope(e.target.value as ReportStatusScope)}>
                  <option value="all">Done and not done</option>
                  <option value="done">Done</option>
                  <option value="not-done">Not done</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowPrintModal(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={async () => {
                setShowPrintModal(false);
                await downloadCombinedReport();
              }} disabled={printLoading || printRangeInvalid}>
                {printLoading ? 'Preparing...' : 'Download .docx'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
    </div>
  );
}

export default Reports;
