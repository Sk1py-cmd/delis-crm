import { requireAccess } from "@/server/guard";
import { getProducts } from "@/server/queries";
import { ProductsClient } from "./ProductsClient";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requireAccess("/products");
  const products = await getProducts();
  const categories = Array.from(new Set(products.map((p) => p.category)));
  return <ProductsClient products={products} categories={categories} />;
}
