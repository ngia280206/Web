import { CookingPot, ChefHat, Sprout } from 'lucide-react';
import type { Resource } from './types';

export const config = {
  dishes: { title: 'Thực đơn', singular: 'món ăn', eyebrow: 'TỪ CĂN BẾP CỦA CHÚNG TÔI', heading: 'Một chút thân quen,', accent: 'một bữa ngon lành.', intro: 'Những món Việt được nấu bằng sự chăm chút. Mộc mạc trong nguyên liệu, trọn vẹn trong từng hương vị.', icon: CookingPot, fields: [{ key: 'name', label: 'Tên món ăn' }, { key: 'description', label: 'Mô tả', type: 'textarea' }, { key: 'price', label: 'Giá (VNĐ)', type: 'number' }, { key: 'category', label: 'Danh mục' }, { key: 'available', label: 'Đang phục vụ', type: 'checkbox' }] },
  chefs: { title: 'Đầu bếp', singular: 'đầu bếp', eyebrow: 'NHỮNG NGƯỜI GIỮ LỬA', heading: 'Đôi bàn tay khéo,', accent: 'cả một tấm lòng.', intro: 'Gặp những người đặt sự tận tâm vào mỗi món ăn, lưu giữ hương vị Việt qua từng ngày đứng bếp.', icon: ChefHat, fields: [{ key: 'name', label: 'Tên đầu bếp' }, { key: 'specialty', label: 'Chuyên môn', type: 'textarea' }] },
  ingredients: { title: 'Nguyên liệu', singular: 'nguyên liệu', eyebrow: 'TỪ NHỮNG ĐIỀU GIẢN DỊ', heading: 'Tươi ngon từ gốc,', accent: 'trọn vị tự nhiên.', intro: 'Một bữa ăn ngon bắt đầu từ nguyên liệu tốt. Chúng tôi trân trọng từng hạt gạo, nhánh rau và hương vị theo mùa.', icon: Sprout, fields: [{ key: 'name', label: 'Tên nguyên liệu' }, { key: 'unit', label: 'Đơn vị' }] },
} satisfies Record<Resource, { title: string; singular: string; eyebrow: string; heading: string; accent: string; intro: string; icon: typeof CookingPot; fields: { key: string; label: string; type?: string }[] }>;

export const money = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
