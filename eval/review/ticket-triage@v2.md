# Review: ticket-triage@v2 (20 of 30 not successful)

Mark each case: model wrong / label wrong / ambiguous. Label mistakes go back into the dataset.

## T01: failed type, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-06",
  "category": "app",
  "app": "Accounting",
  "menu": "Customers > Invoices",
  "label_by_ops": "bug",
  "subject": "PPN di invoice salah hitung",
  "description": "Sejak kemarin PPN 11% di invoice customer terhitung dobel. Contoh INV/2026/00412 seharusnya total 11.100.000 tapi muncul 12.210.000. Semua invoice baru kena.",
  "screenshot_note": "Layar invoice: subtotal 10.000.000, dua baris pajak PPN 11%, total 12.210.000"
}
```
**Expected**: `{"type":"change_impact","priority":"P1","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P1","missing_info":["waktu_mulai"],"needs_human":false,"reason":"PPN dihitung dua kali, bug pada perhitungan pajak."}`

**Labeler note**: Dimulai sehari setelah CHG-01. Faktur salah sampai ke customer dan risiko pajak.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T02: failed type, priority

**Input**
```
{
  "submitted_at": "2026-10-13",
  "category": "app",
  "app": "Sales",
  "menu": "Orders > Quotations",
  "label_by_ops": "bug",
  "subject": "Email quotation tampil berantakan",
  "description": "Setelah kirim quotation lewat email, tampilan di sisi customer kacau: logo tidak muncul dan tombol Lihat dan Setujui hilang.",
  "screenshot_note": "Screenshot email dari customer: tanpa logo, tombol tidak ada"
}
```
**Expected**: `{"type":"change_impact","priority":"P3","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P2","missing_info":[],"needs_human":false,"reason":"Bug pada template email quotation yang menyebabkan logo dan tombol hilang."}`

**Labeler note**: Workaround: kirim PDF manual.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T03: failed type, priority

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "app": "Inventory",
  "menu": "Operations > Deliveries",
  "label_by_ops": "bug",
  "subject": "Tidak bisa validate delivery order",
  "description": "Klik Validate di WH/OUT/00231 muncul error merah. Barang harus dikirim hari ini.",
  "screenshot_note": "Popup error: Gudang tujuan wajib diisi"
}
```
**Expected**: `{"type":"change_impact","priority":"P2","missing_info":["user_terdampak"]}`

**Output**: `{"type":"bug","priority":"P3","missing_info":["waktu_mulai"],"needs_human":false,"reason":"Aplikasi menolak validasi karena error 'Gudang tujuan wajib diisi' yang tidak relevan."}`

**Labeler note**: Belum jelas apakah DO lain juga kena. Kalau banyak DO kena, naik jadi P1 (lihat T04).

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T04: failed type, priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "app": "Inventory",
  "menu": "Operations > Deliveries",
  "label_by_ops": "bug",
  "subject": "Semua DO gudang Cikarang tidak bisa divalidasi",
  "description": "Dari pagi seluruh delivery order di gudang Cikarang gagal divalidasi dengan pesan Gudang tujuan wajib diisi. Truk sudah menunggu.",
  "screenshot_note": "Screenshot daftar 14 DO status Ready, popup error sama"
}
```
**Expected**: `{"type":"change_impact","priority":"P1","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P2","missing_info":["contoh_record"],"needs_human":false,"reason":"Semua DO tidak dapat divalidasi karena bug aplikasi."}`

**Labeler note**: Notifikasi banyak, dampak besar (P1), tapi pastikan dulu apakah input salah atau penyebab lain sebelum serah terima ke project team. Duplikat T03.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T06: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-15",
  "category": "app",
  "app": "Inventory",
  "menu": "Reporting > Stock",
  "label_by_ops": "bug",
  "subject": "Stok di laporan beda dengan fisik",
  "description": "Laporan Stock menampilkan SKU-1182 sebanyak 0 padahal fisik di gudang 120 pcs. Kemarin masih benar.",
  "screenshot_note": "Screenshot laporan: SKU-1182 on hand 0"
}
```
**Expected**: `{"type":"change_impact","priority":"P2","missing_info":[]}`

**Output**: `{"type":"change_impact","priority":"P3","missing_info":["langkah_reproduksi","waktu_mulai"],"needs_human":false,"reason":"Laporan stok berubah setelah update, memerlukan investigasi lebih lanjut"}`

**Labeler note**: Boleh P3 menurut Anda. Putuskan.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T09: failed type

**Input**
```
{
  "submitted_at": "2026-10-15",
  "category": "app",
  "app": "Sales",
  "menu": "Orders > Orders",
  "label_by_ops": "bug",
  "subject": "Cannot confirm sales order",
  "description": "Since this morning tombol Confirm greyed out for user Budi only. User lain normal. Sudah coba logout login.",
  "screenshot_note": "Screenshot: tombol Confirm abu-abu"
}
```
**Expected**: `{"type":"bug","priority":"P3","missing_info":[]}`

**Output**: `{"type":"data","priority":"P3","missing_info":[],"needs_human":false,"reason":"Tombol Confirm tidak aktif hanya untuk user Budi, kemungkinan hak akses."}`

**Labeler note**: Cek access matrix: apakah role user Budi boleh Confirm? Follow up ke comsec.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T10: failed type, priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "app": "Contacts",
  "menu": "Contacts",
  "label_by_ops": "data",
  "subject": "Customer PT Maju Jaya muncul dua kali",
  "description": "Customer PT Maju Jaya ada dua di Contacts dan saldo piutangnya terpecah di dua akun.",
  "screenshot_note": "Screenshot daftar contact: dua baris PT Maju Jaya"
}
```
**Expected**: `{"type":"change_impact","priority":"P3","missing_info":[]}`

**Output**: `{"type":"data","priority":"P2","missing_info":["contoh_record"],"needs_human":false,"reason":"Duplikasi kontak menyebabkan saldo terpecah."}`

**Labeler note**: Setelah migrasi data CHG-04.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T11: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-10",
  "category": "network",
  "label_by_ops": "bug",
  "subject": "WiFi kantor Surabaya putus-putus",
  "description": "Sejak siang WiFi di lantai 2 sering putus, aplikasi jadi lambat."
}
```
**Expected**: `{"type":"other","priority":"P3","missing_info":[]}`

**Output**: `{"type":"other","priority":"P1","missing_info":["user_terdampak"],"needs_human":true,"reason":"Masalah jaringan WiFi, bukan bug aplikasi."}`

**Labeler note**: Bukan masalah aplikasi. Teruskan ke tim infrastruktur.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T13: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-08",
  "category": "app",
  "app": "Accounting",
  "menu": "Customers > Payments",
  "label_by_ops": "bug",
  "subject": "Tombol Register Payment tidak bereaksi",
  "description": "Di Chrome versi terbaru tombol Register Payment tidak bereaksi. Di Edge normal.",
  "screenshot_note": "Screenshot invoice dengan tombol, tanpa error"
}
```
**Expected**: `{"type":"bug","priority":"P3","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P2","missing_info":["langkah_reproduksi"],"needs_human":false,"reason":"Tombol Register Payment tidak bereaksi di Chrome, bug."}`

**Labeler note**: Ada workaround pakai Edge.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T15: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-15",
  "category": "app",
  "app": "Purchase",
  "menu": "Orders > Requests for Quotation",
  "label_by_ops": "bug",
  "subject": "Email RFQ ke vendor tidak terkirim",
  "description": "Sejak pagi RFQ yang dikirim dari sistem tidak sampai ke vendor. Status sudah Sent tapi vendor bilang tidak menerima."
}
```
**Expected**: `{"type":"bug","priority":"P2","missing_info":["contoh_record"]}`

**Output**: `{"type":"bug","priority":"P1","missing_info":[],"needs_human":false,"reason":"Email RFQ tidak terkirim meskipun status Sent, jadi bug."}`

**Labeler note**: Cek mail server internal dan konfirmasi ke vendor. Bisa berubah setelah semua dikonfirmasi.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T16: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-15",
  "category": "app",
  "app": "Purchase",
  "menu": "Orders > Requests for Quotation",
  "label_by_ops": "bug",
  "subject": "Vendor tidak terima email PO",
  "description": "Dua vendor konfirmasi tidak menerima email PO yang kami kirim dari Odoo hari ini."
}
```
**Expected**: `{"type":"bug","priority":"P2","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P3","missing_info":["contoh_record","langkah_reproduksi"],"needs_human":false,"reason":"Email PO tidak terkirim ke vendor"}`

**Labeler note**: Duplikat T15. Cek mail server internal dan konfirmasi ke vendor.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T18: failed type, priority

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "app": "Sales",
  "menu": "Reporting",
  "label_by_ops": "bug",
  "subject": "Laporan penjualan sangat lambat",
  "description": "Laporan penjualan bulanan butuh sekitar 5 menit untuk tampil. Besok dipakai untuk rapat."
}
```
**Expected**: `{"type":"bug","priority":"P3","missing_info":["langkah_reproduksi"]}`

**Output**: `{"type":"other","priority":"P2","missing_info":["langkah_reproduksi"],"needs_human":false,"reason":"Laporan penjualan sangat lambat, perlu ditangani segera."}`

**Labeler note**: Perlu filter periode dan jumlah data.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T19: failed type

**Input**
```
{
  "submitted_at": "2026-10-02",
  "category": "app",
  "app": "Accounting",
  "menu": "Accounting > Journal Entries",
  "label_by_ops": "data",
  "subject": "Jurnal tidak bisa di-post saat closing",
  "description": "Closing bulan September batas akhirnya besok pagi, tapi jurnal penyesuaian tidak bisa di-post. Muncul pesan periode terkunci.",
  "screenshot_note": "Popup: tanggal jurnal berada pada periode yang sudah dikunci"
}
```
**Expected**: `{"type":"data","priority":"P1","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P1","missing_info":[],"needs_human":false,"reason":"Jurnal tidak dapat dipost karena periode terkunci, masalah aplikasi."}`

**Labeler note**: Kemungkinan lock date. Periode closing: dampak tinggi dan urgensi tinggi.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T21: failed type, priority

**Input**
```
{
  "submitted_at": "2026-10-10",
  "category": "app",
  "app": "Inventory",
  "menu": "Operations > Receipts",
  "label_by_ops": "bug",
  "subject": "Receipt tidak bisa divalidasi, minta lot",
  "description": "Validate receipt WH/IN/00077 diminta lot number padahal produk ini tidak pakai lot.",
  "screenshot_note": "Popup: Silakan isi lot untuk produk SKU-3321"
}
```
**Expected**: `{"type":"data","priority":"P3","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P2","missing_info":[],"needs_human":false,"reason":"Aplikasi meminta lot untuk produk yang tidak menggunakan lot."}`

**Labeler note**: Kemungkinan salah konfigurasi tracking produk. Label data dipertahankan (konfigurasi tracking produk); model memilih bug.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T22: failed type

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "label_by_ops": "bug",
  "subject": "URGENT!!! sistem error semua!!!",
  "description": "Tolong segera dibantu, sistem error semua!!!"
}
```
**Expected**: `{"type":"bug","priority":"unknown","missing_info":["contoh_record","langkah_reproduksi","pesan_error","user_terdampak","waktu_mulai"]}`

**Output**: `{"type":"other","priority":"unknown","missing_info":["langkah_reproduksi","pesan_error","waktu_mulai","user_terdampak"],"needs_human":true,"reason":"Tidak ada detail spesifik tentang error."}`

**Labeler note**: Jangan langsung P1 hanya karena nada tulisan. Minta info dulu.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T25: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "app": "Accounting",
  "menu": "Reporting",
  "label_by_ops": "data",
  "subject": "Aged Receivable beda dengan Trial Balance",
  "description": "Total laporan Aged Receivable berbeda dengan Trial Balance, selisih 2,3 juta rupiah per 30 September.",
  "screenshot_note": "Screenshot dua laporan"
}
```
**Expected**: `{"type":"data","priority":"P3","missing_info":[]}`

**Output**: `{"type":"data","priority":"P2","missing_info":["contoh_record"],"needs_human":false,"reason":"Perbedaan laporan menunjukkan data tidak konsisten."}`

**Labeler note**: Mungkin terkait migrasi customer. Putuskan apakah naik P2.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T26: failed priority, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-12",
  "category": "app",
  "app": "Employees",
  "menu": "Employees",
  "label_by_ops": "bug",
  "subject": "Saya bisa lihat gaji karyawan",
  "description": "Saya dari tim Sales tapi bisa membuka tab data gaji di menu Employees.",
  "screenshot_note": "Screenshot tab Salary terbuka"
}
```
**Expected**: `{"type":"bug","priority":"P2","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P1","missing_info":["user_terdampak"],"needs_human":true,"reason":"Pengguna tidak seharusnya dapat melihat data gaji."}`

**Labeler note**: Menurut access matrix, role Sales tidak boleh melihat tab gaji. Follow up ke comsec dan beri tahu Team Leader.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T27: failed priority

**Input**
```
{
  "submitted_at": "2026-10-14",
  "category": "app",
  "app": "Purchase",
  "menu": "Orders > Requests for Quotation",
  "label_by_ops": "bug",
  "subject": "Approval PO tidak masuk ke manager",
  "description": "Sejak kemarin PO di atas 50 juta tidak ada notifikasi approval ke manager, PO menggantung."
}
```
**Expected**: `{"type":"bug","priority":"P2","missing_info":["contoh_record"]}`

**Output**: `{"type":"bug","priority":"P1","missing_info":["langkah_reproduksi","contoh_record","waktu_mulai"],"needs_human":false,"reason":"Bug karena notifikasi approval tidak muncul setelah PO > 50 juta."}`


- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T28: failed type, asks_for_info_when_needed

**Input**
```
{
  "submitted_at": "2026-10-13",
  "category": "app",
  "app": "Sales",
  "menu": "Orders > Quotations",
  "label_by_ops": "bug",
  "subject": "Logo di email quotation hilang",
  "description": "Customer kami bilang logo tidak muncul di email penawaran terbaru."
}
```
**Expected**: `{"type":"change_impact","priority":"P3","missing_info":[]}`

**Output**: `{"type":"bug","priority":"P3","missing_info":["contoh_record"],"needs_human":false,"reason":"Logo tidak muncul di email quotation"}`

**Labeler note**: Duplikat T02.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## T30: failed type, priority

**Input**
```
{
  "submitted_at": "2026-10-15",
  "category": "app",
  "app": "Accounting",
  "menu": "Vendors > Bills",
  "label_by_ops": "bug",
  "screenshot_note": "Layar Odoo: pesan Access Denied saat membuka Accounting > Vendors > Bills"
}
```
**Expected**: `{"type":"bug","priority":"P3","missing_info":["langkah_reproduksi","user_terdampak"]}`

**Output**: `{"type":"data","priority":"unknown","missing_info":["user_terdampak"],"needs_human":true,"reason":"Pengguna tidak memiliki hak akses ke menu Vendors > Bills"}`

**Labeler note**: Hanya screenshot. Info minim, template tiket yang lebih baik mencegah ini. Model memilih route_comsec karena Access Denied, wajar, tapi label tetap needs_info.

- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous
