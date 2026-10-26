import ExpoModulesCore
import StoreKit

/// Returns Apple's signed JWS for the newest verified, active auto-renewable subscription of this app.
/// The server verifies the signature; the app only carries the string. "No entitlement" is null, never an error.
public class StorekitProofModule: Module {
  private static let bundleId = "com.ibrahim1774.aibarber"

  public func definition() -> ModuleDefinition {
    Name("StorekitProof")

    AsyncFunction("getCurrentEntitlementJWS") { () async -> [String: String]? in
      var newest: (date: Date, jws: String, originalId: String)? = nil
      for await result in Transaction.currentEntitlements {
        guard case .verified(let transaction) = result else { continue }
        guard transaction.productType == .autoRenewable,
              transaction.appBundleID == StorekitProofModule.bundleId,
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
