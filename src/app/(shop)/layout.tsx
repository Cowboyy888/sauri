import { getDb } from "@/lib/db/client";
import { getCategories, getMaterialOptions } from "@/lib/storefront/catalog";
import { CartProvider } from "@/components/storefront/cart/cart-provider";
import { CartDrawer } from "@/components/storefront/cart/cart-drawer";
import { WishlistProvider } from "@/components/storefront/wishlist/wishlist-provider";
import { Header } from "@/components/storefront/layout/header";
import { Footer } from "@/components/storefront/layout/footer";
import { AttributionCapture } from "@/components/storefront/attribution-capture";
import { AnalyticsCapture } from "@/components/storefront/analytics-capture";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [categories, materials] = await Promise.all([getCategories(getDb()), getMaterialOptions(getDb())]);
  return (
    <CartProvider>
      <WishlistProvider>
        <AttributionCapture />
        <AnalyticsCapture />
        <Header categories={categories} materials={materials} />
        <main>{children}</main>
        <Footer />
        <CartDrawer />
      </WishlistProvider>
    </CartProvider>
  );
}
