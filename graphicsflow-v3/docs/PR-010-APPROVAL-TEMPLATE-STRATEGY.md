# PR 010 — Approval Template Strategy

## Decision

GraphicsFlow V3 will not attempt to visually recreate the Hood Container approval form with HTML/CSS.

For Hood Container, the Approval Creator will use the existing read-only reference template:

`PHP version/HCC APPROVAL FORM-2026.pdf`

The V3 implementation will follow the proven V2 workflow:

1. Read the selected G# and Approval input data.
2. Normalize all non-note text values to uppercase.
3. Build FDF field data for the exact AcroForm field names in the PDF.
4. Fill the original PDF with `pdftk fill_form ... need_appearances`.
5. Place the selected artwork PDF into the established artwork box using a PDF composition helper.
6. Render the completed temporary PDF for preview.
7. Do not save or overwrite any server file during preview.
8. Require a separate, deliberate save/download action for any final output.

## Current HCC field mapping

The current template uses these header fields:

- `CUSTOMER`
- `CUST #`
- `SPEC #`
- `DESIGN #`
- `ART #`
- `I.D`
- `TEST`
- `Sales Rep`
- `APPROVAL CREATION DATE`
- `DATE APPROVED`
- `Signature1_es_:signer:signature`

The revision table uses four rows:

- `ART REV 0` through `ART REV 3`
- `rev date 0` through `rev date 3`
- `DESCR 0` through `DESCR 3`
- `CSR 0` through `CSR 3`
- `DSR 0` through `DSR 3`

The current checkboxes are:

- `Check Box SAMPLE`
- `Check Box APPROVED`
- `Check Box DIGITAL PRINT`
- `Check Box DIGITAL CUT`
- `Check Box DIE CUT BAYSEK`
- `Check Box DIE CUT LABEL`
- `Check Box PROCESS`

The established artwork placement box is:

`26,150,740,385`

PDF coordinates are measured in points from the bottom-left corner.

## Multi-company direction

Approval data and Approval templates remain separate.

Hood Container will initially use the fixed `HCC APPROVAL FORM-2026.pdf` adapter. Future companies can supply their own template adapter with:

- template PDF path
- field mapping
- checkbox mapping
- artwork placement box
- company-specific validation/defaults

A future Approval Layout Creator can generate these adapters without replacing the Approval document data model.

## Uppercase policy

All text-entry fields throughout GraphicsFlow are normalized to uppercase while typing, including Approval and revision fields. Note fields are the only exception.

A note field can explicitly opt out by setting:

```tsx
<textarea data-note-field="true" />
```

Fields whose name, id, placeholder, or accessible label clearly contains `note` or `notes` are also treated as note fields.
