---
name: testing-and-evidence
description: Enforces phase-scoped testing, honest verification, reproducible evidence, regression protection, and reviewer-controlled completion decisions.
---

# Testing and Evidence Skill

## When to use

Sử dụng skill này khi:

* Lập kế hoạch kiểm thử cho một phase.
* Viết hoặc sửa unit test, integration test hoặc security test.
* Kiểm tra transaction, concurrency hoặc idempotency.
* Xác minh migration hoặc database invariant.
* Chạy type checking, lint hoặc production build.
* Điều tra test thất bại hoặc flaky test.
* Chuẩn bị báo cáo hoàn thành IMPLEMENT.
* Đề nghị Reviewer nghiệm thu.

## Mandatory rules

### 1. Xác định phạm vi kiểm thử

Trước khi chạy test, agent phải xác định:

* Phase hiện tại.
* Invariant thuộc phạm vi phase.
* Module và file đã thay đổi.
* Nhóm test bắt buộc.
* Regression suite liên quan.
* Build và verification command cần chạy.
* Test environment và database target nếu có.

Chỉ chạy hoặc bổ sung test cho phạm vi hiện tại và regression liên quan.

Không được tạo implementation của phase sau chỉ để đáp ứng một mục test chung.

Nhóm test không thuộc phạm vi phải ghi:

`Not applicable to current phase`

### 2. Nhóm kiểm tra bắt buộc

Trước khi báo cáo hoàn thành, phải chạy các nhóm phù hợp với phase hiện tại:

* Unit tests.
* Integration tests.
* Security tests nếu phase có security behavior.
* Concurrency và idempotency tests nếu phase có cập nhật đồng thời hoặc retry contract.
* Database-invariant tests nếu phase có database invariant.
* Migration verification nếu phase tạo hoặc sửa schema/migration.
* Regression tests liên quan.
* Type checking nếu project có cấu hình.
* Lint nếu project có cấu hình.
* Production build.

Không được coi TypeScript compile hoặc lint là thay thế cho unit/integration tests.

### 3. Test phải kiểm tra đúng invariant

Test phải:

* Kiểm tra observable behavior và invariant thực tế.
* Có expected result dựa trên Domain Contract.
* Bao phủ cả success path và failure path.
* Kiểm tra rollback khi transaction thất bại.
* Kiểm tra idempotent retry khi contract yêu cầu.
* Kiểm tra race condition bằng execution đồng thời thực tế khi áp dụng.
* Kiểm tra database protection qua đường có thể vượt application guard khi invariant yêu cầu.
* Dùng dữ liệu test deterministic.
* Không phụ thuộc thứ tự chạy test.
* Không phụ thuộc wall-clock time nếu không được kiểm soát.

Concurrency và transaction tests không được mock mất:

* Database transaction.
* Unique constraint.
* Optimistic locking.
* Database trigger hoặc constraint đang cần xác minh.

### 4. Test environment

Agent phải xác định và báo cáo:

* Test runner.
* Node/runtime version nếu có ảnh hưởng.
* Database environment.
* Test database có cô lập hay không.
* Biến môi trường quan trọng đã được cấu hình nhưng không lộ secret.
* Test có chạy tuần tự hay song song.
* Seed hoặc fixture được sử dụng.

Không được chạy test ghi/xóa dữ liệu trên production, staging hoặc development database dùng chung.

### 5. Xử lý test thất bại

Khi test FAIL, agent phải:

1. Ghi lại command và lỗi thực tế.
2. Xác định lỗi thuộc implementation, test, fixture hay environment.
3. Không sửa expected result để hợp thức hóa code sai.
4. Sửa nguyên nhân gốc trong phạm vi được phép.
5. Chạy lại test bị ảnh hưởng.
6. Chạy lại regression suite liên quan.
7. Báo cáo cả lần FAIL ban đầu và kết quả sau khi sửa.

Không được chỉ cung cấp lần chạy cuối cùng rồi che giấu lỗi đã xảy ra.

### 6. Flaky test

Agent không được chạy lặp một test nhiều lần đến khi tình cờ PASS rồi báo cáo xanh.

Nếu một test có kết quả không ổn định:

* Ghi số lần chạy.
* Ghi các lần PASS và FAIL.
* Xác định nguyên nhân nếu có thể.
* Không đánh dấu test là ổn định.
* Không bỏ qua flaky failure.
* Dừng nghiệm thu nếu flaky test ảnh hưởng invariant quan trọng.

Retry test chỉ được dùng để chẩn đoán, không dùng để che lỗi.

### 7. Test integrity

Agent không được:

* Xóa test cũ để đạt xanh.
* Chuyển test thành `skip`, `todo`, disabled hoặc comment-out mà không có Reviewer approval.
* Xóa assertion quan trọng.
* Làm expected result rộng hơn để code sai vẫn pass.
* Mock mất hành vi đang cần kiểm tra.
* Hạ coverage threshold.
* Loại file khỏi coverage chỉ để tăng tỷ lệ.
* Thay đổi test timeout vô lý để che deadlock hoặc performance issue.
* Thay đổi test order để che state leakage.
* Bỏ regression test thất bại vì cho rằng “không liên quan” mà chưa chứng minh.

Nếu test cũ phải thay đổi do Domain Contract được Reviewer sửa, báo cáo phải chỉ rõ quyết định Reviewer làm cơ sở.

### 8. Coverage

Nếu project đã có coverage policy:

* Không được hạ threshold.
* Phải báo cáo coverage trước và sau nếu thay đổi đáng kể.
* Các branch chứa invariant quan trọng phải có test.
* Coverage cao không thay thế cho test đúng hành vi.

Nếu project chưa có coverage policy, không tự đặt một con số tùy ý làm điều kiện PASS trừ khi prompt yêu cầu.

### 9. Build verification

Production build phải:

* Chạy bằng command thực tế của project.
* Có exit code thành công.
* Không phụ thuộc file chưa commit hoặc migration chưa apply mà không được báo cáo.
* Không bỏ qua lỗi type bằng cấu hình tạm thời.
* Không vô hiệu hóa lint/type check chỉ để build xanh.
* Không sử dụng development server startup thay cho production build.

Build warning quan trọng phải được liệt kê, đặc biệt:

* Security warning.
* Deprecated dependency có ảnh hưởng.
* Missing environment variable.
* Dynamic import hoặc runtime error risk.
* Database generation/migration mismatch.

### 10. Migration verification

Khi phase có thay đổi database, phải kiểm tra:

* Prisma schema validation.
* Migration SQL.
* Migration apply trên test database cô lập.
* Migration status.
* Schema/constraint sau apply.
* Seed nếu thuộc phạm vi.
* Drift nếu công cụ hỗ trợ.

Khi phase không thay đổi database, ghi:

`Migration verification: Not applicable to current phase`

Không chạy migration chỉ để có log nếu phase không liên quan.

### 11. Báo cáo từng command

Mỗi command phải báo cáo:

* Mục đích.
* Command chính xác.
* Working directory nếu cần.
* Test environment.
* Exit code.
* Thời điểm hoặc thứ tự chạy.
* Số PASS.
* Số FAIL.
* Số SKIP/TODO.
* Tên hoặc nhóm test bị bỏ qua.
* Lý do bỏ qua.
* Phần chưa được xác minh.
* Đoạn log quan trọng.

Không cần dán hàng nghìn dòng log lặp lại, nhưng không được cắt bỏ phần chứa:

* Failure.
* Warning quan trọng.
* Summary.
* Exit status.
* Test count.

Nếu log được rút gọn, phải ghi rõ log đã được rút gọn và phần nào được giữ lại.

### 12. Kết luận tác vụ

Agent chỉ được đánh dấu một command là `PASS` khi:

* Command đã thực sự chạy.
* Exit code thành công.
* Không có failure bị che giấu.
* Không có test bắt buộc bị skip trái phép.
* Kết quả thực tế được cung cấp.

Agent không được tự tuyên bố:

* `Phase PASS`
* `Production Ready`
* `Fully verified`

Cách diễn đạt phù hợp:

> Các kiểm tra được liệt kê đã chạy với kết quả đính kèm. Implementation đang chờ Reviewer nghiệm thu.

## Forbidden actions

Agent không được:

* Tuyên bố test PASS khi chưa chạy.
* Dùng “should pass”, “likely passes” hoặc “expected to pass”.
* Chỉ chạy test mới và bỏ regression test liên quan.
* Chỉ chạy test file riêng rồi tuyên bố toàn bộ suite PASS.
* Che giấu lần test FAIL trước đó.
* Retry flaky test đến khi xanh rồi bỏ qua failure.
* Xóa, skip hoặc làm yếu test.
* Hạ coverage threshold.
* Mock mất invariant cần kiểm tra.
* Chạy concurrency test hoàn toàn bằng mock.
* Dùng compile thay cho integration test.
* Dùng development build thay cho production build.
* Bỏ migration verification khi phase thay đổi database.
* Tạo test route hoặc bypass production security chỉ để test dễ hơn.
* Chạy test ghi dữ liệu trên database không được cô lập.
* Tạo bằng chứng, log hoặc số lượng test giả.
* Tự sửa Domain Contract vì test khó viết.

## Required evidence

Báo cáo cuối phải có:

* Phase và phạm vi kiểm thử.
* Danh sách file implementation đã thay đổi.
* Danh sách test file tạo hoặc sửa.
* Test environment.
* Database target đã được redacted an toàn.
* Unit-test command và kết quả.
* Integration-test command và kết quả.
* Security-test command và kết quả nếu áp dụng.
* Concurrency/idempotency command và kết quả nếu áp dụng.
* Regression-test command và kết quả.
* Type-check command và kết quả nếu project có.
* Lint command và kết quả nếu project có.
* Migration-verification command và kết quả nếu áp dụng.
* Production-build command và kết quả.
* Exit code từng command.
* Tổng PASS/FAIL/SKIP.
* Danh sách skipped tests và lý do.
* Flaky-test status.
* Coverage status nếu project có policy.
* Failure history và cách khắc phục.
* Known limitations.
* Phần chưa xác minh.
* Manual verification checklist.

Các nhóm không thuộc phạm vi phải ghi:

`Not applicable to current phase`

## Stop conditions

Agent phải dừng và báo cáo khi:

* Test bắt buộc không thể chạy.
* Test environment không được xác định.
* Test database không được cô lập.
* Có nguy cơ test đang ghi vào dữ liệu thật.
* Unit hoặc integration test quan trọng vẫn FAIL.
* Production build FAIL.
* Migration verification FAIL khi phase có database change.
* Concurrency test không thể kiểm tra bằng hạ tầng thật phù hợp.
* Flaky test ảnh hưởng invariant quan trọng chưa được xử lý.
* Test bắt buộc bị skip mà chưa có Reviewer approval.
* Cần xóa hoặc làm yếu test mới có thể tiếp tục.
* Cần hạ coverage threshold mới đạt.
* Kết quả giữa các lần chạy mâu thuẫn chưa giải thích được.
* Không thể phân biệt lỗi implementation với lỗi môi trường.
* Không thể cung cấp bằng chứng thực tế.
* Việc sửa test yêu cầu thay đổi Domain Contract chưa được duyệt.

Khi dừng, agent phải báo cáo:

* Command đã chạy.
* Exit code.
* Lỗi thực tế.
* Test environment.
* Phần đã xác minh.
* Phần chưa xác minh.
* Ảnh hưởng đến nghiệm thu.
* Quyết định cần Reviewer đưa ra.

Không tự báo cáo hoàn thành khi còn stop condition chưa được giải quyết.
