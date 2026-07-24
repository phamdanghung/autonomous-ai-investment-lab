---
name: project-governance
description: Ensures agents follow approved project phases, scope boundaries, evidence requirements, and reviewer authority without making unsupported assumptions.
---

# Project Governance Skill

## When to use

Sử dụng skill này:

* Khi bắt đầu mọi tác vụ kỹ thuật.
* Khi bắt đầu một phase mới.
* Trước khi tạo hoặc sửa file.
* Khi phát hiện yêu cầu có thể vượt phạm vi.
* Trước khi chạy migration.
* Trước khi báo cáo hoàn thành.
* Trước khi đề xuất chuyển sang phase tiếp theo.

## Mandatory rules

Trước khi thực hiện công việc, agent phải:

1. Đọc và áp dụng theo đúng thứ tự ưu tiên:

   * Binding Reviewer Amendments mới nhất.
   * Prompt của phase hiện tại.
   * Domain Contract đã duyệt.
   * `AGENTS.md`.
   * Skill chuyên môn liên quan.

2. Xác định rõ:

   * Phase hiện tại.
   * Trạng thái `PLAN ONLY` hay `IMPLEMENT`.
   * Phạm vi được phép.
   * Những nội dung bị loại khỏi phạm vi.
   * Các entity hoặc module được phép thay đổi.
   * Danh sách file dự kiến tạo hoặc sửa.
   * Test và build command dự kiến chạy.

3. Kiểm tra đã có phê duyệt rõ ràng để implement hay chưa.

4. Chỉ thực hiện thay đổi cần thiết cho phase hiện tại.

5. Báo cáo kết quả dựa trên bằng chứng thực tế, không dựa trên suy đoán.

6. Khi không chạy được test hoặc build, phải ghi rõ:

   * Command đã chạy.
   * Exit code.
   * Lỗi thực tế.
   * Nguyên nhân đã xác minh.
   * Phần chưa được kiểm chứng.
   * Ảnh hưởng tới khả năng nghiệm thu.

7. Kết thúc đúng phạm vi được giao và chờ Reviewer nghiệm thu.

## Forbidden actions

Agent không được:

* Implement khi phase vẫn ở trạng thái `PLAN ONLY`.
* Làm công việc của phase sau.
* Tự mở rộng phạm vi.
* Tự thay đổi kiến trúc hoặc Domain Contract đã khóa.
* Tự thêm entity, bảng, API hoặc tính năng “để dùng sau”.
* Tự chuyển sang phase kế tiếp.
* Tự tuyên bố `Phase PASS`.
* Tự tuyên bố `Production Ready`.
* Tuyên bố hoàn thành khi test hoặc build bắt buộc chưa chạy.
* Dùng ngôn ngữ giả định như:

  * “should pass”
  * “likely works”
  * “expected to build”
  * “probably correct”
* Che giấu test thất bại, build lỗi hoặc giới hạn chưa xử lý.
* Tự bỏ, xóa hoặc skip test để đạt kết quả xanh.
* Tiếp tục refactor sau khi đã hoàn thành phạm vi được giao.

## Required evidence

Báo cáo cuối của tác vụ IMPLEMENT phải có tối thiểu:

* Phase và phạm vi đã thực hiện.
* Files created.
* Files changed.
* Lý do thay đổi.
* Command test đã chạy.
* Exit code của từng command.
* Tổng số test PASS.
* Tổng số test FAIL.
* Test bị skip và lý do.
* Build command.
* Build result và exit code.
* Migration summary nếu có.
* Known limitations.
* Những nội dung chưa hoàn thành.
* Manual verification checklist.

Chỉ được đánh dấu một command là `PASS` khi:

* Command đã thực sự được chạy.
* Exit code thành công.
* Không có test bắt buộc bị bỏ qua trái phép.
* Log hoặc kết quả thực tế được cung cấp.

## Stop conditions

Agent phải dừng và báo cáo Reviewer khi:

* Chưa có phê duyệt để implement.
* Yêu cầu vượt phạm vi phase hiện tại.
* Có mâu thuẫn giữa Reviewer Amendment và tài liệu khác.
* Không xác định được tài liệu nào có độ ưu tiên cao hơn.
* Cần thêm entity, bảng hoặc module của phase sau.
* Cần thay đổi Domain Contract đã khóa.
* Cần reset hoặc phá dữ liệu mới có thể tiếp tục.
* Migration có nguy cơ mất dữ liệu.
* Test bắt buộc không thể chạy.
* Build thất bại.
* Không thể bảo đảm invariant quan trọng.
* Phát hiện secret hoặc nguy cơ ảnh hưởng dữ liệu thật.
* Không thể xác minh kết quả implementation.

Khi dừng, agent phải mô tả vấn đề cụ thể và không tự triển khai phương án thay thế chưa được phê duyệt.

## Completion wording

Không được kết thúc bằng tuyên bố phase đã PASS.

Cách kết thúc phù hợp:

> Implementation đã hoàn thành trong phạm vi được giao. Các command được liệt kê đã chạy với kết quả đính kèm và đang chờ Reviewer nghiệm thu.
