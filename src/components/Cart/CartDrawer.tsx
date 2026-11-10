import "./CartDrawer.css";
import type { TentPricingRequest } from "../../services/pricingService";

export type CartItem = {
  id: string;
  name: string;
  configuration: string[];
  unitPrice: number;
  quantity: number;
  colors: {
    fabric: string;
    inner: string;
    frame: string;
  };
  pricingRequest: TentPricingRequest;
  /** Local 3D preview. Shopify needs a hosted URL for checkout thumbnails. */
  previewImage?: string;
};

interface CartDrawerProps {
  open: boolean;
  items: CartItem[];
  onClose: () => void;
  onQuantityChange: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
}

function CartDrawer({
  open,
  items,
  onClose,
  onQuantityChange,
  onRemove,
  onCheckout,
}: CartDrawerProps) {
  if (!open) return null;

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const formatPrice = (price: number) =>
    `₹${price.toLocaleString("en-IN")}`;

  return (
    <div className="cart-overlay" onClick={onClose}>
      <aside
        className="cart-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        <div className="cart-header">
          <div>
            <h2>Your Cart</h2>
            <p>{totalQuantity} item(s)</p>
          </div>
          <button
            type="button"
            className="cart-close"
            onClick={onClose}
            aria-label="Close cart"
          >
            ×
          </button>
        </div>

        {items.length === 0 ? (
          <div className="cart-empty">
            <span>🛒</span>
            <h3>Your cart is empty</h3>
            <p>Add your customized tent to get started.</p>
            <button type="button" onClick={onClose}>
              Continue Customizing
            </button>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {items.map((item) => (
                <article className="cart-item" key={item.id}>
                  {item.previewImage && (
                    <img
                      src={item.previewImage}
                      alt={`${item.name} customized 3D preview`}
                      style={{
                        display: "block",
                        width: "100%",
                        maxHeight: 180,
                        objectFit: "contain",
                        background: "#f5f5f5",
                        borderRadius: 8,
                        marginBottom: 12,
                      }}
                    />
                  )}
                  <div className="cart-item-heading">
                    <h3>{item.name}</h3>
                    <button
                      type="button"
                      className="cart-remove"
                      onClick={() => onRemove(item.id)}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="cart-colors">
                    <span>
                      Fabric
                      <i style={{ background: item.colors.fabric }} />
                    </span>
                    <span>
                      Inner
                      <i style={{ background: item.colors.inner }} />
                    </span>
                    <span>
                      Frame
                      <i style={{ background: item.colors.frame }} />
                    </span>
                  </div>

                  <div className="cart-configuration">
                    {item.configuration.map((option, index) => (
                      <div
                        className="cart-configuration-item"
                        key={`${item.id}-${index}`}
                      >
                        {option}
                      </div>
                    ))}
                  </div>

                  <div className="cart-item-footer">
                    <div className="cart-quantity">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        onClick={() =>
                          onQuantityChange(item.id, item.quantity - 1)
                        }
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        onClick={() =>
                          onQuantityChange(item.id, item.quantity + 1)
                        }
                      >
                        +
                      </button>
                    </div>
                    <strong>
                      {formatPrice(item.unitPrice * item.quantity)}
                    </strong>
                  </div>

                  <p className="cart-unit-price">
                    {formatPrice(item.unitPrice)} per tent
                  </p>
                </article>
              ))}
            </div>

            <div className="cart-footer">
              <div className="cart-subtotal">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>
              <p>Demo cart only. Taxes and shipping are not included.</p>
              <button
                type="button"
                className="cart-continue"
                onClick={onCheckout}
              >
                Proceed to Checkout
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export default CartDrawer;
