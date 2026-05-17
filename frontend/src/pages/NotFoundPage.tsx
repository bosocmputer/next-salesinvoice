import { Paper, Stack } from "@mui/material";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppButton, EmptyState, PageHeader } from "../components/ui";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="ไม่พบหน้า"
        title="ลิงก์นี้ไม่มีในระบบ"
        description="ตรวจสอบ URL อีกครั้ง หรือกลับไปหน้าแก้ไขบิลเพื่อเริ่มงานใหม่"
        actions={<AppButton onClick={() => navigate("/bulk-edit")} startIcon={<ChevronLeft size={16} />}>กลับไปแก้ไขบิล</AppButton>}
      />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <EmptyState title="ไม่พบหน้าที่ต้องการ" description="ระบบอาจย้ายเส้นทางหรือ URL ไม่ครบถ้วน" />
      </Paper>
    </Stack>
  );
}
