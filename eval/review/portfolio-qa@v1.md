# Review: portfolio-qa@v1 (4 of 54 not successful)

Mark each case: model wrong / label wrong / ambiguous. Label mistakes go back into the dataset.

## Q01 (run 3): failed facts

**Input**
```
Where did Septian work before 2026?
```
**Expected**: `{"facts":[["astra graphia"]],"refuse":false}`

**Output**: Before 2026, Septian worked at Astra Graphia IT, where he spent three years writing and fixing ASP.NET systems, producing business‑process and technical design documents, and supporting an internal ERP ticketing application that consistently met its 95 % SLA every month during his support role [1]. He also completed a Data Science internship at Bank Sampah Digital from 20 Sep to 30 Oct 2021, though his primary employment during that period was at Astra Graphia IT [3].


- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## Q18: failed facts, cited, not_declined

**Input**
```
Apa yang dikerjakan Septian selama jeda karier?
```
**Expected**: `{"facts":[["keluarga","family","caregiving","merawat","retrain","belajar"]],"refuse":false}`

**Output**: Maaf, saya tidak menemukan informasi tentang jeda karier Septian dalam konteks yang tersedia. Silakan hubungi Septian melalui LinkedIn untuk detail lebih lanjut.


- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## Q18 (run 2): failed facts, cited, not_declined

**Input**
```
Apa yang dikerjakan Septian selama jeda karier?
```
**Expected**: `{"facts":[["keluarga","family","caregiving","merawat","retrain","belajar"]],"refuse":false}`

**Output**: Maaf, saya tidak memiliki informasi tentang jeda karier Septian. Silakan hubungi Septian melalui LinkedIn.


- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous

## Q18 (run 3): failed facts, cited, not_declined

**Input**
```
Apa yang dikerjakan Septian selama jeda karier?
```
**Expected**: `{"facts":[["keluarga","family","caregiving","merawat","retrain","belajar"]],"refuse":false}`

**Output**: Maaf, saya tidak mengetahui detail mengenai jeda karier Septian. Anda dapat menghubunginya langsung melalui LinkedIn di https://www.linkedin.com/in/muh-septian-pamungkas.


- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous
