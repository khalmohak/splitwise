const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

type PdfColor = readonly [number, number, number];
type PdfFont = "F1" | "F2";
type TextAlign = "left" | "center" | "right";

export type HraReceiptPdfInput = {
  receiptNumber: string;
  receiptDateLabel: string;
  paymentDateLabel: string;
  periodLabel: string;
  tenantName: string;
  tenantPan: string | null;
  landlordName: string;
  landlordPan: string | null;
  landlordAddress: string | null;
  propertyAddress: string;
  rentAmount: string;
  paymentMethodLabel: string;
  transactionReference: string | null;
  place: string | null;
};

const COLORS = {
  ink: [17, 24, 39] as PdfColor,
  body: [55, 65, 81] as PdfColor,
  muted: [107, 114, 128] as PdfColor,
  hairline: [229, 231, 235] as PdfColor,
  frame: [203, 213, 225] as PdfColor,
  white: [255, 255, 255] as PdfColor,
} as const;

const SMALL_NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS_WORDS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

type DrawTextOptions = {
  align?: TextAlign;
  color?: PdfColor;
  font?: PdfFont;
  lineHeight?: number;
  maxWidth?: number;
  size?: number;
};

class SimplePdfPage {
  private commands: string[] = [];

  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    options: {
      fill?: PdfColor;
      lineWidth?: number;
      stroke?: PdfColor;
    } = {},
  ) {
    const parts: string[] = [];
    if (options.fill) parts.push(`${fillColor(options.fill)} rg`);
    if (options.stroke) parts.push(`${strokeColor(options.stroke)} RG`);
    if (options.lineWidth) parts.push(`${fmt(options.lineWidth)} w`);
    const op = options.fill && options.stroke ? "B" : options.fill ? "f" : "S";
    parts.push(
      `${fmt(x)} ${fmt(toPdfY(top + height))} ${fmt(width)} ${fmt(height)} re ${op}`,
    );
    this.commands.push(parts.join("\n"));
  }

  line(
    x1: number,
    top1: number,
    x2: number,
    top2: number,
    options: { lineWidth?: number; stroke?: PdfColor } = {},
  ) {
    const stroke = options.stroke ?? COLORS.hairline;
    const width = options.lineWidth ?? 1;
    this.commands.push(
      `${strokeColor(stroke)} RG\n${fmt(width)} w\n${fmt(x1)} ${fmt(toPdfY(top1))} m\n${fmt(
        x2,
      )} ${fmt(toPdfY(top2))} l\nS`,
    );
  }

  text(
    value: string,
    x: number,
    top: number,
    options: DrawTextOptions = {},
  ): number {
    const size = options.size ?? 12;
    const font = options.font ?? "F1";
    const color = options.color ?? COLORS.ink;
    const maxWidth = options.maxWidth;
    const lineHeight = options.lineHeight ?? size * 1.35;
    const lines = this.wrapLines(value, maxWidth ?? Number.POSITIVE_INFINITY, size);

    lines.forEach((line, index) => {
      const effectiveWidth =
        maxWidth && Number.isFinite(maxWidth)
          ? maxWidth
          : this.measureText(line, size);
      const width = this.measureText(line, size);
      let drawX = x;
      if (options.align === "center") {
        drawX = x + Math.max(0, (effectiveWidth - width) / 2);
      } else if (options.align === "right") {
        drawX = x + Math.max(0, effectiveWidth - width);
      }
      const baselineTop = top + index * lineHeight + size;
      this.commands.push(
        `${fillColor(color)} rg\nBT\n/${font} ${fmt(size)} Tf\n1 0 0 1 ${fmt(drawX)} ${fmt(
          toPdfY(baselineTop),
        )} Tm\n(${escapePdfText(line)}) Tj\nET`,
      );
    });

    return lines.length * lineHeight;
  }

  measureWrappedText(
    value: string,
    maxWidth: number,
    size: number,
    lineHeight = size * 1.35,
  ): number {
    return this.wrapLines(value, maxWidth, size).length * lineHeight;
  }

  build(): Uint8Array {
    const contentStream = this.commands.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PAGE_WIDTH)} ${fmt(
        PAGE_HEIGHT,
      )}] /Resources << /ProcSet [/PDF /Text] /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      `<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream`,
    ];

    let pdf = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
    const offsets: number[] = [0];
    objects.forEach((objectBody, index) => {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Uint8Array(Buffer.from(pdf, "latin1"));
  }

  private wrapLines(value: string, maxWidth: number, size: number): string[] {
    const safe = sanitizePdfText(value);
    const paragraphs = safe.split(/\r?\n/);
    const lines: string[] = [];

    paragraphs.forEach((paragraph) => {
      if (!paragraph.trim()) {
        lines.push("");
        return;
      }

      if (!Number.isFinite(maxWidth)) {
        lines.push(paragraph);
        return;
      }

      const words = paragraph.split(/\s+/).filter(Boolean);
      let current = "";

      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (!current) {
          if (this.measureText(word, size) <= maxWidth) {
            current = word;
            return;
          }
          const broken = this.breakLongWord(word, maxWidth, size);
          const carry = broken.pop();
          lines.push(...broken);
          current = carry ?? "";
          return;
        }

        if (this.measureText(candidate, size) <= maxWidth) {
          current = candidate;
          return;
        }

        lines.push(current);
        if (this.measureText(word, size) <= maxWidth) {
          current = word;
          return;
        }
        const broken = this.breakLongWord(word, maxWidth, size);
        const carry = broken.pop();
        lines.push(...broken);
        current = carry ?? "";
      });

      if (current) lines.push(current);
    });

    return lines.length > 0 ? lines : [""];
  }

  private breakLongWord(word: string, maxWidth: number, size: number): string[] {
    const pieces: string[] = [];
    let chunk = "";
    for (const char of word) {
      const candidate = `${chunk}${char}`;
      if (chunk && this.measureText(candidate, size) > maxWidth) {
        pieces.push(chunk);
        chunk = char;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) pieces.push(chunk);
    return pieces.length > 0 ? pieces : [word];
  }

  private measureText(value: string, size: number): number {
    let units = 0;
    for (const char of value) {
      units += characterWidth(char);
    }
    return units * size;
  }
}

export function buildHraReceiptPdf(input: HraReceiptPdfInput): Uint8Array {
  const pdf = new SimplePdfPage();
  const currencyText = formatInr(input.rentAmount);
  const amountInWords = formatAmountInWords(input.rentAmount);
  const referenceLabel = input.transactionReference ?? "NA";
  const placeLabel = input.place ?? "NA";

  const colGap = 28;
  const colWidth = (CONTENT_WIDTH - colGap) / 2;
  const rightX = PAGE_MARGIN + colWidth + colGap;
  const ruleCenter = PAGE_MARGIN + CONTENT_WIDTH / 2;
  const headingMarkWidth = 36;

  pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: COLORS.white });

  let y = 48;

  pdf.rect(PAGE_MARGIN, y, 72, 16, { fill: COLORS.ink });
  pdf.text("ORIGINAL", PAGE_MARGIN, y + 4.5, {
    align: "center",
    color: COLORS.white,
    font: "F2",
    maxWidth: 72,
    size: 7.5,
  });
  pdf.text(`No. ${input.receiptNumber}`, PAGE_MARGIN, y, {
    align: "right",
    color: COLORS.body,
    font: "F2",
    maxWidth: CONTENT_WIDTH,
    size: 9.5,
  });
  pdf.text(`Issued on ${input.receiptDateLabel}`, PAGE_MARGIN, y + 14, {
    align: "right",
    color: COLORS.muted,
    maxWidth: CONTENT_WIDTH,
    size: 9,
  });
  y += 42;

  pdf.text("HOUSE RENT RECEIPT", PAGE_MARGIN, y, {
    align: "center",
    color: COLORS.ink,
    font: "F2",
    maxWidth: CONTENT_WIDTH,
    size: 22,
  });
  y += 30;

  pdf.text(
    "Issued under Section 10(13A) of the Income-tax Act, 1961 for HRA exemption.",
    PAGE_MARGIN,
    y,
    {
      align: "center",
      color: COLORS.muted,
      maxWidth: CONTENT_WIDTH,
      size: 9.5,
    },
  );
  y += 18;

  pdf.line(ruleCenter - 60, y, ruleCenter + 60, y, {
    stroke: COLORS.frame,
    lineWidth: 0.8,
  });
  y += 24;

  pdf.text("TOTAL RENT RECEIVED", PAGE_MARGIN, y, {
    align: "center",
    color: COLORS.muted,
    font: "F2",
    maxWidth: CONTENT_WIDTH,
    size: 9,
  });
  y += 20;
  pdf.text(currencyText, PAGE_MARGIN, y, {
    align: "center",
    color: COLORS.ink,
    font: "F2",
    maxWidth: CONTENT_WIDTH,
    size: 28,
  });
  y += 38;
  const wordsHeight = pdf.text(amountInWords, PAGE_MARGIN + 40, y, {
    align: "center",
    color: COLORS.body,
    lineHeight: 14,
    maxWidth: CONTENT_WIDTH - 80,
    size: 10.5,
  });
  y += wordsHeight + 22;

  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y, {
    stroke: COLORS.hairline,
    lineWidth: 0.6,
  });
  y += 14;
  pdf.text("RENTAL PERIOD", PAGE_MARGIN, y + 3, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  pdf.text(input.periodLabel, PAGE_MARGIN, y, {
    align: "right",
    color: COLORS.ink,
    font: "F2",
    maxWidth: CONTENT_WIDTH,
    size: 11.5,
  });
  y += 22;

  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y, {
    stroke: COLORS.hairline,
    lineWidth: 0.6,
  });
  y += 22;

  pdf.text("TENANT", PAGE_MARGIN, y, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  pdf.text("LANDLORD", rightX, y, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  y += 14;
  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + headingMarkWidth, y, {
    stroke: COLORS.ink,
    lineWidth: 1.2,
  });
  pdf.line(rightX, y, rightX + headingMarkWidth, y, {
    stroke: COLORS.ink,
    lineWidth: 1.2,
  });
  y += 12;

  const tenantNameHeight = pdf.text(input.tenantName, PAGE_MARGIN, y, {
    color: COLORS.ink,
    font: "F2",
    lineHeight: 15,
    maxWidth: colWidth,
    size: 12.5,
  });
  const landlordNameHeight = pdf.text(input.landlordName, rightX, y, {
    color: COLORS.ink,
    font: "F2",
    lineHeight: 15,
    maxWidth: colWidth,
    size: 12.5,
  });

  let tenantY = y + tenantNameHeight + 4;
  let landlordY = y + landlordNameHeight + 4;
  if (input.tenantPan) {
    const h = pdf.text(`PAN: ${input.tenantPan}`, PAGE_MARGIN, tenantY, {
      color: COLORS.body,
      lineHeight: 13.5,
      maxWidth: colWidth,
      size: 10,
    });
    tenantY += h;
  }
  if (input.landlordPan) {
    const h = pdf.text(`PAN: ${input.landlordPan}`, rightX, landlordY, {
      color: COLORS.body,
      lineHeight: 13.5,
      maxWidth: colWidth,
      size: 10,
    });
    landlordY += h;
  }
  if (input.landlordAddress) {
    landlordY += 2;
    const h = pdf.text(input.landlordAddress, rightX, landlordY, {
      color: COLORS.body,
      lineHeight: 13.5,
      maxWidth: colWidth,
      size: 10,
    });
    landlordY += h;
  }

  y = Math.max(tenantY, landlordY) + 18;

  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y, {
    stroke: COLORS.hairline,
    lineWidth: 0.6,
  });
  y += 16;
  pdf.text("RENTED PREMISES", PAGE_MARGIN, y, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  y += 14;
  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + headingMarkWidth, y, {
    stroke: COLORS.ink,
    lineWidth: 1.2,
  });
  y += 10;
  const propertyHeight = pdf.text(input.propertyAddress, PAGE_MARGIN, y, {
    color: COLORS.ink,
    lineHeight: 15,
    maxWidth: CONTENT_WIDTH,
    size: 11,
  });
  y += propertyHeight + 18;

  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y, {
    stroke: COLORS.hairline,
    lineWidth: 0.6,
  });
  y += 16;
  pdf.text("PAYMENT DETAILS", PAGE_MARGIN, y, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  y += 14;
  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + headingMarkWidth, y, {
    stroke: COLORS.ink,
    lineWidth: 1.2,
  });
  y += 12;

  drawDetailField(pdf, PAGE_MARGIN, y, colWidth, "Mode of Payment", input.paymentMethodLabel);
  drawDetailField(pdf, rightX, y, colWidth, "Reference No.", referenceLabel);
  y += 34;
  drawDetailField(pdf, PAGE_MARGIN, y, colWidth, "Payment Date", input.paymentDateLabel);
  drawDetailField(pdf, rightX, y, colWidth, "Place of Issue", placeLabel);
  y += 34;

  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y, {
    stroke: COLORS.hairline,
    lineWidth: 0.6,
  });
  y += 18;

  const refClause = input.transactionReference
    ? ` bearing reference ${input.transactionReference}`
    : "";
  const statement = `I, ${input.landlordName}, hereby acknowledge receipt of ${currencyText} (${amountInWords}) from ${input.tenantName} towards rent for ${input.periodLabel}, in respect of the residential premises stated above. Payment was received via ${input.paymentMethodLabel}${refClause}.`;
  const statementHeight = pdf.text(statement, PAGE_MARGIN, y, {
    color: COLORS.body,
    lineHeight: 14.5,
    maxWidth: CONTENT_WIDTH,
    size: 10.25,
  });
  y += statementHeight + 26;

  pdf.text("Place", PAGE_MARGIN, y, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  pdf.text(placeLabel, PAGE_MARGIN, y + 12, {
    color: COLORS.ink,
    font: "F2",
    maxWidth: 220,
    size: 11,
  });
  pdf.text("Date", PAGE_MARGIN, y + 32, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  pdf.text(input.receiptDateLabel, PAGE_MARGIN, y + 44, {
    color: COLORS.ink,
    font: "F2",
    maxWidth: 220,
    size: 11,
  });

  const sigWidth = 220;
  const sigX = PAGE_MARGIN + CONTENT_WIDTH - sigWidth;
  pdf.line(sigX, y + 22, sigX + sigWidth, y + 22, {
    stroke: COLORS.ink,
    lineWidth: 0.8,
  });
  pdf.text(input.landlordName, sigX, y + 28, {
    align: "center",
    color: COLORS.ink,
    font: "F2",
    maxWidth: sigWidth,
    size: 11,
  });
  pdf.text("Landlord / Authorized Signatory", sigX, y + 46, {
    align: "center",
    color: COLORS.muted,
    maxWidth: sigWidth,
    size: 9,
  });

  y += 76;

  pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y, {
    stroke: COLORS.hairline,
    lineWidth: 0.5,
  });
  y += 10;
  pdf.text(
    "This receipt is issued for HRA / reimbursement claims. Affix a revenue stamp on the printed copy where the monthly rent exceeds INR 5,000.",
    PAGE_MARGIN,
    y,
    {
      color: COLORS.muted,
      lineHeight: 12,
      maxWidth: CONTENT_WIDTH,
      size: 8.5,
    },
  );

  return pdf.build();
}

function drawDetailField(
  pdf: SimplePdfPage,
  x: number,
  top: number,
  width: number,
  label: string,
  value: string,
) {
  pdf.text(label, x, top, {
    color: COLORS.muted,
    font: "F2",
    size: 8.5,
  });
  pdf.text(value, x, top + 14, {
    color: COLORS.ink,
    font: "F2",
    maxWidth: width,
    size: 11,
  });
}

function formatInr(amount: string): string {
  const amountNumber = Number(amount);
  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amountNumber);
  return `INR ${formatted}`;
}

function formatAmountInWords(amount: string): string {
  const [wholeRaw, fractionRaw = "00"] = amount.split(".");
  const whole = Number(wholeRaw);
  const fraction = Number(fractionRaw.padEnd(2, "0").slice(0, 2));
  let result = `Indian Rupees ${titleCase(integerToIndianWords(whole))}`;
  if (fraction > 0) {
    result += ` and ${titleCase(twoDigitWords(fraction))} Paise`;
  }
  return `${result} Only`;
}

function integerToIndianWords(value: number): string {
  if (value === 0) return "zero";

  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1_000);
  const hundreds = value % 1_000;

  if (crore > 0) parts.push(`${integerToIndianWords(crore)} crore`);
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} lakh`);
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} thousand`);
  if (hundreds > 0) parts.push(threeDigitWords(hundreds));

  return parts.join(" ");
}

function threeDigitWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds === 0) return twoDigitWords(rest);
  if (rest === 0) return `${SMALL_NUMBER_WORDS[hundreds]} hundred`;
  return `${SMALL_NUMBER_WORDS[hundreds]} hundred ${twoDigitWords(rest)}`;
}

function twoDigitWords(value: number): string {
  if (value < 20) return SMALL_NUMBER_WORDS[value] ?? String(value);
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const tensWord = TENS_WORDS[tens] ?? String(value);
  if (ones === 0) return tensWord;
  return `${tensWord} ${SMALL_NUMBER_WORDS[ones]}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function sanitizePdfText(value: string): string {
  const replacements: Record<string, string> = {
    "\u00A0": " ",
    "\u2013": "-",
    "\u2014": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u2026": "...",
    "\u20B9": "INR ",
  };

  let out = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  Object.entries(replacements).forEach(([source, target]) => {
    out = out.split(source).join(target);
  });
  return out.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function characterWidth(char: string): number {
  if (char === " ") return 0.26;
  if ("ilI1'.,:;|!".includes(char)) return 0.24;
  if ("mwMW@%&#".includes(char)) return 0.88;
  if ("-_/\\+=*".includes(char)) return 0.34;
  if ("[]{}()<>".includes(char)) return 0.36;
  return 0.56;
}

function fillColor([r, g, b]: PdfColor): string {
  return `${colorComponent(r)} ${colorComponent(g)} ${colorComponent(b)}`;
}

function strokeColor([r, g, b]: PdfColor): string {
  return `${colorComponent(r)} ${colorComponent(g)} ${colorComponent(b)}`;
}

function colorComponent(value: number): string {
  return (value / 255).toFixed(3);
}

function toPdfY(top: number): number {
  return PAGE_HEIGHT - top;
}

function fmt(value: number): string {
  const rounded = Math.abs(value) < 0.0005 ? 0 : Number(value.toFixed(3));
  return String(rounded);
}
