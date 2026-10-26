import ExpoModulesCore
import StoreKit

/// Returns Apple's signed JWS for the newest verified, active auto-renewable subscription of this app.
/// The server verifies the signature; the app only carries the string. "No entitlement" is null, never an error.
public class StorekitProofModule: Module {
  private static let bundleId = "com.ibrahim1774.aibarber"
  /// The six SITE products only (src/lib/publish.ts PRODUCT_IDS). The domain subscription is deliberately excluded:
  /// its originalTransactionId is not the site purchase the server moves.
  private static let siteProductIds: Set<String> = [
    "com.ibrahim1774.aibarber.hosting.monthly",
    "com.ibrahim1774.aibarber.hosting.yearly",
    "com.ibrahim1774.aibarber.bookings.monthly",
    "com.ibrahim1774.aibarber.bookings.yearly",
    "com.ibrahim1774.aibarber.store.monthly",
    "com.ibrahim1774.aibarber.store.yearly",
  ]

  public func definition() -> ModuleDefinition {
    Name("StorekitProof")

    AsyncFunction("getCurrentEntitlementJWS") { () async -> [String: String]? in
      var newest: (date: Date, jws: String, originalId: String)? = nil
      for await result in Transaction.currentEntitlements {
        guard case .verified(let transaction) = result else { continue }
        guard transaction.productType == .autoRenewable,
              transaction.appBundleID == StorekitProofModule.bundleId,
              StorekitProofModule.siteProductIds.contains(transaction.productID),
              transaction.revocationDate == nil else { continue }
        if newest == nil || transaction.purchaseDate > newest!.date {
          newest = (transaction.purchaseDate, result.jwsRepresentation, String(transaction.originalID))
        }
      }
      guard let best = newest else { return nil }
      return ["jws": best.jws, "originalTransactionId": best.originalId]
    }
  }
}
