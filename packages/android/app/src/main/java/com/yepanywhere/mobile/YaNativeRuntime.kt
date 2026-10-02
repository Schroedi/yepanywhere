package com.yepanywhere.mobile

import android.content.Context
import com.yepanywhere.mobile.connection.YaRustProfileConnector
import com.yepanywhere.mobile.connection.YaRustTls
import com.yepanywhere.mobile.connection.YaPairingCoordinator
import com.yepanywhere.mobile.connection.YaServerConnectionManager
import com.yepanywhere.mobile.profiles.YaPairedServerStore
import com.yepanywhere.mobile.security.AndroidKeystoreSecurityClientKeyStore
import com.yepanywhere.mobile.security.YaAndroidSecurityClientDescriptorProvider
import com.yepanywhere.mobile.security.YaSecurityClientCoordinator
import java.io.Closeable

class YaNativeRuntime(context: Context) : Closeable {
    private val securityKeys = AndroidKeystoreSecurityClientKeyStore()
    val pairedServers = YaPairedServerStore.create(context, securityKeys = securityKeys)
    private val connector = YaRustProfileConnector(pairedServers)
    init { YaRustTls.ensure(context) }
    private val securityClients = YaSecurityClientCoordinator(
        repository = pairedServers,
        keys = securityKeys,
        descriptors = YaAndroidSecurityClientDescriptorProvider(context),
    )
    val pairing = YaPairingCoordinator(pairedServers, connector, securityClients)
    private val connectionManagers = mutableMapOf<String, YaServerConnectionManager>()

    @Synchronized
    fun connectionManager(profileId: String): YaServerConnectionManager {
        return connectionManagers.getOrPut(profileId) {
            YaServerConnectionManager(
                profileId = profileId,
                repository = pairedServers,
                connector = connector,
                securityClients = securityClients,
            )
        }
    }

    override fun close() {
        val managers = synchronized(this) {
            connectionManagers.values.toList().also { connectionManagers.clear() }
        }
        managers.forEach { it.close() }
        connector.close()
        pairedServers.close()
    }
}
