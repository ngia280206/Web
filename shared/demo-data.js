export function createDemoData() {
  const chefs = [{id:1,name:'Nguyễn Thanh An',specialty:'Món Việt'}, {id:2,name:'Trần Minh Hương',specialty:'Món cuốn'}, {id:3,name:'Lê Hoài Phương',specialty:'Món ngọt'}];
  const ingredients = [{id:1,name:'Gạo',unit:'kg'}, {id:2,name:'Thịt gà',unit:'kg'}, {id:3,name:'Rau thơm',unit:'bó'}, {id:4,name:'Ngô',unit:'kg'}, {id:5,name:'Lạc',unit:'g'}, {id:6,name:'Dứa',unit:'quả'}];
  const names = ['Cơm gà','Chicken soup','Bánh cuốn','Chè ngô','Gỏi đậu phộng','Canh rau','Gà kho','Bún thịt','Dứa tráng miệng','Chicken curry','Cơm chiên','Gỏi cuốn'];
  const dishes = Array.from({length:72},(_,i)=>({id:i+1,name:`${names[i%names.length]} · mẫu ${Math.floor(i/names.length)+1}`,description:'Dữ liệu minh họa cho phân trang và tìm kiếm; không phải món từ Supabase hoặc Kaggle.',price:30000+(i%9)*10000,category:['Món chính','Món canh','Tráng miệng'][i%3],available:i%4!==0,chefId:i%5===0?null:(i%3)+1,source:'demo',imageUrl:null,
    chef:i%5===0?null:chefs[i%3],ingredients:[ingredients[i%6],ingredients[(i+1)%6]]}));
  return {dishes,chefs,ingredients};
}
