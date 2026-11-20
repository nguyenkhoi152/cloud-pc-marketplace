/**
 * Nội dung màn Giới thiệu. Mỗi câu bám vào một nguồn có thật trong dự án:
 *  - Quy tắc tiền (gói 15 phút, phí 10%, ân hạn 10 phút, trọng tài 24 giờ): docs/CONTRACT_SPEC.md và contracts/deployments/fuji.json.
 *  - Điều kiện thuê/cho thuê, tạm khóa, dữ liệu: docs/MVP.md, docs/SECURITY.md (§12), docs/DATA_MODEL.md và giao diện hiện có.
 * Không viết thêm cam kết pháp lý, thời gian hoạt động, bảo mật tuyệt đối hay liên hệ hỗ trợ: chưa có căn cứ trong sản phẩm.
 * Không ghi cứng tên mạng ("Avalanche Fuji"...): tên mạng suy từ cấu hình của bản build và chỉ hiện ở tab "Mạng & hợp đồng"
 * (bản dùng ví cục bộ hay bản xem trước không được gọi là Fuji).
 * Nếu đổi cấu hình hợp đồng (gói, phí, ân hạn, trọng tài) hoặc quy tắc trong app thì sửa tại đây.
 */

export const ABOUT_UPDATED = "20/11/2026";

export const PURPOSE =
  "Cloud PC Companion giúp bạn dùng sức mạnh của một máy tính khác khi cần, và tận dụng chiếc máy của mình khi nó đang rảnh. " +
  "Người thuê mở desktop Linux của máy thuê ngay trong app; chủ máy nhận PCP mỗi khi có người thuê. " +
  "Mọi khoản thanh toán đi qua hợp đồng giữ tiền, nên cả hai bên đều biết trước khoản nào đang được giữ, khi nào được trả và khi nào được hoàn.";

/** Ba con số tóm tắt dưới phần Mục đích; trùng đúng với quy tắc ở tab Thanh toán (gói 15 phút, phí 10%, hủy trước kích hoạt hoàn đủ). */
export const HIGHLIGHTS: { value: string; label: string }[] = [
  { value: "15 phút", label: "mỗi gói thuê" },
  { value: "90%", label: "giá gói chủ máy nhận" },
  { value: "Hoàn đủ", label: "khi hủy trước kích hoạt" },
];

export interface Audience {
  id: "rent" | "host";
  title: string;
  who: string;
  needs: string[];
}
export const AUDIENCES: Audience[] = [
  {
    id: "rent",
    title: "Người thuê",
    who: "Dành cho bạn nếu cần một máy mạnh hơn máy đang có trong thời gian ngắn: dựng đồ họa, chơi game, biên dịch hoặc dùng công cụ lập trình.",
    needs: ["Một tài khoản và một ví đã liên kết.", "PCP để trả tiền thuê (ví mới có thể nhận miễn phí để thử).", "Một ít AVAX thử nghiệm để trả phí giao dịch."],
  },
  {
    id: "host",
    title: "Chủ máy",
    who: "Dành cho bạn nếu có máy Windows thường để rảnh và muốn cho thuê theo lịch của mình.",
    needs: [
      "Máy Windows có WSL2, đủ để chạy một bản Linux dành riêng cho việc cho thuê.",
      "App kiểm tra và hướng dẫn từng bước; máy cần quét đạt điều kiện trước khi được đăng.",
      "Kết nối mạng ổn định trong các khung giờ đã cam kết.",
    ],
  },
];

export const PCP_FACTS: string[] = [
  "PC Point (PCP) là token thử nghiệm dùng để trả tiền thuê máy trong app.",
  "PCP chạy trên mạng thử và không có giá trị quy đổi: không mua, bán hay rút ra tiền thật.",
  "PCP chỉ di chuyển giữa ví của bạn và hợp đồng giữ tiền, không chuyển trực tiếp giữa người dùng.",
  "Ví mới có thể nhận 1.000 PCP miễn phí một lần ở mục Ví (khi tính năng này đang bật). Giao dịch trên chuỗi cần một ít AVAX thử nghiệm để trả phí mạng; app có thể gửi giúp một ít, tối đa một lần mỗi 24 giờ.",
];

export interface Step {
  title: string;
  text: string;
}
export const RENTER_STEPS: Step[] = [
  { title: "Chọn và giữ máy", text: "Lọc máy theo nhu cầu, cấu hình và giá rồi giữ máy. Máy được giữ cho bạn trong thời hạn thanh toán và chưa có khoản nào bị trừ. Chỉ máy đang online mới thuê được." },
  { title: "Trả tiền", text: "Ký giao dịch trong ví để PCP vào hợp đồng giữ tiền. Chủ máy chưa nhận gì ở bước này." },
  { title: "Chuẩn bị máy", text: "Máy dựng một desktop Linux sạch dành riêng cho phiên của bạn." },
  { title: "Kích hoạt", text: "Hợp đồng ghi nhận phiên bắt đầu. Gói 15 phút tính từ lúc kích hoạt, kể cả thời gian chờ kết nối." },
  { title: "Dùng máy", text: "Màn hình máy thuê hiện ngay trong app. Hết gói, kết nối tự ngắt." },
  { title: "Kết thúc và thanh toán", text: "Bạn kết thúc hoặc đợi hết gói. Hợp đồng chia tiền: chủ máy nhận phần của họ, phí nền tảng được trừ." },
  { title: "Thu hồi và dọn máy", text: "Quyền truy cập bị thu hồi và dữ liệu trong máy thuê bị xóa. Máy chưa nhận khách mới cho tới khi dọn xong." },
];
export const HOST_STEPS: Step[] = [
  { title: "Tạo tài khoản và liên kết ví", text: "Ví dùng để nhận PCP và rút về sau này." },
  { title: "Thiết lập máy", text: "Ở màn Thiết lập & chạy máy, app kiểm tra máy của bạn và hướng dẫn từng bước các phần còn thiếu." },
  { title: "Quét và đăng máy", text: "Bạn chỉ đặt tên và viết mô tả ngắn. CPU, RAM, GPU và ổ đĩa do app đọc từ máy của bạn khi quét. Máy đạt điều kiện được đăng ngay, không cần chờ duyệt." },
  { title: "Đặt cam kết và lịch", text: "Cam kết cho thuê tối thiểu 4 giờ và lịch nhận thuê hằng tuần (mỗi khung tối thiểu 30 phút, tính theo mốc 15 phút)." },
  { title: "Bắt đầu nhận thuê", text: "Bạn chọn chia sẻ bao nhiêu RAM và CPU cho khách; số này hiện trên thẻ máy. Máy chỉ nhận khách khi bạn bấm Bắt đầu nhận thuê, và bạn có thể ngừng nhận phiên mới bất cứ lúc nào." },
  { title: "Nhận PCP", text: "Sau khi phiên tất toán, phần của bạn nằm trong hợp đồng; rút về ví ở màn Thu nhập." },
];

export type PaymentIcon = "clock" | "lock" | "undo" | "flag" | "percent" | "scale" | "download" | "pause";
export interface PaymentRule {
  icon: PaymentIcon;
  title: string;
  text: string;
}
export const PAYMENT_RULES: PaymentRule[] = [
  { icon: "clock", title: "Gói thuê 15 phút", text: "Giá do chủ máy đặt và hiển thị trước khi bạn giữ máy. Không tự gia hạn và không tính tiền theo giây." },
  { icon: "lock", title: "Tiền nằm trong hợp đồng", text: "PCP được giữ trong hợp đồng cho tới khi phiên kết thúc. Quản trị viên và người vận hành không lấy được tiền đang giữ." },
  { icon: "undo", title: "Hủy trước khi kích hoạt", text: "Hoàn đủ, không mất phí." },
  { icon: "flag", title: "Kết thúc sớm vẫn trả cả gói", text: "Sau khi máy đã được kích hoạt, kết thúc sớm hay hết gói đều trả đủ giá gói." },
  { icon: "percent", title: "Phí 10%", text: "Chủ máy nhận 90% giá gói; 10% là phí nền tảng (cấu hình hiện tại). Mức phí được ghi cố định vào từng phiên khi đặt." },
  {
    icon: "scale",
    title: "Tranh chấp",
    text:
      "Người thuê hoặc chủ máy có thể mở tranh chấp khi phiên đang chạy và trong 10 phút sau khi hết gói; tiền được giữ chờ trọng tài. Nếu sau 24 giờ chưa có quyết định, người thuê được hoàn đủ và chủ máy có thể không nhận được tiền của phiên đó. Nút mở tranh chấp trong app đang được hoàn thiện.",
  },
  { icon: "download", title: "Rút tiền về ví", text: "Tiền hoàn và thu nhập nằm trong hợp đồng cho tới khi chủ ví rút về. Nếu giao dịch rút lỗi, quyền rút vẫn được giữ." },
  { icon: "pause", title: "Khi hệ thống tạm dừng", text: "Quản trị viên có thể tạm dừng phiên mới. Hủy, hoàn tiền và rút tiền vẫn dùng được." },
];

export interface TermGroup {
  title: string;
  items: string[];
}
export const TERMS: TermGroup[] = [
  {
    title: "Phạm vi",
    items: [
      "Cloud PC Companion hiện là bản thử nghiệm chạy trên mạng thử (xem tab Mạng & hợp đồng). PCP và AVAX thử nghiệm không có giá trị tiền.",
      "Tính năng, giá, gói thuê và mức phí có thể thay đổi. Phiên đã đặt giữ nguyên mức phí và thời hạn tại thời điểm đặt.",
      "Chưa có đặt lịch trước, tự gia hạn hay tính tiền theo giây: bạn thuê ngay khi máy đủ điều kiện.",
    ],
  },
  {
    title: "Tài khoản và ví",
    items: ["Mỗi tài khoản liên kết một ví đã xác minh bằng chữ ký. Bạn chịu trách nhiệm bảo quản ví đã liên kết.", "Chỉ đổi được ví khi không còn phiên thuê nào đang diễn ra."],
  },
  {
    title: "Khi thuê máy",
    items: [
      "Máy thuê do một chủ máy cung cấp và chủ máy có quyền quản trị máy đó về mặt kỹ thuật. Đừng đăng nhập tài khoản cá nhân hay nhập thông tin nhạy cảm vào máy thuê.",
      "Dữ liệu trong máy thuê bị xóa khi phiên kết thúc. Hãy tải về mọi thứ cần giữ trước đó.",
      "Không dùng máy thuê để tấn công hệ thống khác, phát tán mã độc, vi phạm bản quyền hoặc làm việc trái pháp luật.",
    ],
  },
  {
    title: "Khi cho thuê máy",
    items: [
      "Chỉ đăng máy bạn có quyền sử dụng và mô tả đúng thực tế. Cấu hình hiển thị cho người thuê do app đọc từ máy của bạn và không được kiểm định độc lập; tên và mô tả do bạn tự viết.",
      "Khách dùng một bản Linux dành riêng, không phải desktop Windows của bạn. Dù vậy đây không phải môi trường cô lập tuyệt đối: hãy dùng máy không chứa dữ liệu quan trọng.",
      "Giữ máy online trong các khung giờ đã cam kết. Máy mất kết nối sẽ hiện ngoại tuyến và không nhận khách.",
    ],
  },
  {
    title: "Dữ liệu ứng dụng lưu",
    items: [
      "Email, tên hiển thị, địa chỉ ví đã liên kết, thông tin và lịch của máy bạn đăng, lịch sử đặt chỗ và nhật ký các thao tác quan trọng.",
      "Bạn chỉ xem được dữ liệu của mình. Quản trị viên xem được dữ liệu vận hành để quản lý và xử lý sự cố.",
      "Giao dịch PCP trên mạng thử là công khai trên chuỗi khối: ai cũng xem được địa chỉ ví và số tiền.",
    ],
  },
  {
    title: "Tạm khóa",
    items: [
      "Quản trị viên có thể tạm khóa chủ máy hoặc gỡ máy khi thông số sai lệch, máy không hoạt động thật hoặc có hành vi gây hại.",
      "Máy bị tạm khóa không còn trong danh sách. Tiền đang giữ trong phiên vẫn được xử lý theo hợp đồng; quản trị viên không lấy được số tiền đó.",
    ],
  },
  {
    title: "Giới hạn của bản thử nghiệm",
    items: [
      "Không cam kết thời gian hoạt động hay hiệu năng. Chất lượng phiên phụ thuộc máy của chủ máy và mạng của cả hai bên.",
      "Máy được đăng không qua bước duyệt thủ công, nên hãy chọn máy cẩn thận.",
    ],
  },
];
